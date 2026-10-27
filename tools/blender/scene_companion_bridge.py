# Scene Companion Bridge — a Blender add-on.
# In the Scene Companion editor, select an object and tap "→ Blender": its GLB opens here in a collection
# named "SC <id>". Edit it, then press "Send Back": the edited GLB replaces the model on that object in the editor
# (same id, transform and behaviors) and in any live game.
#
# Install: Edit > Preferences > Add-ons > Install from Disk… > this file, then tick it.
# Use: 3D View sidebar (N) > Scene Companion > set the dev server (default http://localhost:8080, the machine
# running `npm run dev`) > Start. It polls the dev server once a second over plain HTTP; no other setup.
bl_info = {
    "name": "Scene Companion Bridge",
    "author": "Scene Companion",
    "version": (0, 1, 0),
    "blender": (3, 6, 0),
    "location": "View3D > Sidebar > Scene Companion",
    "description": "Edit Scene Companion models in Blender and send them back to the editor",
    "category": "Import-Export",
}

import json
import os
import tempfile
import urllib.parse
import urllib.request

import bpy

_state = {"on": False, "status": "stopped"}


def _server(context=None):
    return ((context or bpy.context).scene.sc_server or "http://localhost:8080").rstrip("/")


def _request(path, data=None, timeout=5):
    req = urllib.request.Request(_server() + path, data=data, method="POST" if data is not None else "GET")
    if data is not None:
        req.add_header("Content-Type", "application/octet-stream")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def _collection_for(sc_id):
    return next((c for c in bpy.data.collections if c.get("sc_id") == sc_id), None)


def _remove_collection(coll):
    for o in list(coll.all_objects):
        bpy.data.objects.remove(o, do_unlink=True)
    bpy.data.collections.remove(coll)


def import_job(job):
    """Download one queued model and import it into its own "SC <id>" collection (replacing an older copy)."""
    sc_id, glb = job["id"], job["glb"]
    path = glb[2:] if glb.startswith("./") else glb.lstrip("/")
    data = _request("/" + urllib.parse.quote(path), timeout=60)
    tmp = os.path.join(tempfile.gettempdir(), f"sc_in_{sc_id}.glb")
    with open(tmp, "wb") as f:
        f.write(data)
    old = _collection_for(sc_id)
    if old:
        _remove_collection(old)
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=tmp)
    new = [o for o in bpy.data.objects if o not in before]
    coll = bpy.data.collections.new(f"SC {sc_id}")
    bpy.context.scene.collection.children.link(coll)
    for o in new:
        for c in list(o.users_collection):
            c.objects.unlink(o)
        coll.objects.link(o)
    coll["sc_id"], coll["sc_glb"], coll["sc_scene"] = sc_id, glb, job.get("scene", "")
    coll["sc_prefab"] = job.get("prefab", "")  # set: Send Back updates the prefab file, so every instance changes
    return coll


def send_back(coll, draco=False):
    """Export the collection as GLB and post it to the dev server. Returns the server's reply."""
    view_objects = bpy.context.view_layer.objects
    for o in view_objects:
        o.select_set(False)
    for o in coll.all_objects:
        if o.name in view_objects:
            o.select_set(True)
    tmp = os.path.join(tempfile.gettempdir(), f"sc_out_{coll['sc_id']}.glb")
    bpy.ops.export_scene.gltf(filepath=tmp, export_format="GLB", use_selection=True, export_yup=True,
                              export_animations=True, export_draco_mesh_compression_enable=draco)
    with open(tmp, "rb") as f:
        data = f.read()
    q = urllib.parse.urlencode({"id": coll["sc_id"], "scene": coll.get("sc_scene", ""), "prefab": coll.get("sc_prefab", "")})
    return json.loads(_request(f"/bridge/return?{q}", data=data, timeout=120))


def poll():
    """Timer: take queued models from the dev server. Returns seconds until the next poll (None stops)."""
    if not _state["on"]:
        return None
    try:
        for job in json.loads(_request("/bridge/inbox")):
            coll = import_job(job)
            _state["status"] = f"opened {coll['sc_id']}"
        if not _state["status"].startswith("opened"):
            _state["status"] = "connected"
    except Exception as e:  # keep polling; the dev server may just be restarting
        _state["status"] = f"can't reach {_server()}: {e}"
    return 1.0


class SC_OT_toggle(bpy.types.Operator):
    bl_idname = "scene_companion.toggle"
    bl_label = "Start / Stop"
    bl_description = "Start or stop listening for models sent from the Scene Companion editor"

    def execute(self, context):
        _state["on"] = not _state["on"]
        _state["status"] = "starting…" if _state["on"] else "stopped"
        if _state["on"] and not bpy.app.timers.is_registered(poll):
            bpy.app.timers.register(poll, first_interval=0.1, persistent=True)
        return {"FINISHED"}


class SC_OT_send_back(bpy.types.Operator):
    bl_idname = "scene_companion.send_back"
    bl_label = "Send Back"
    bl_description = "Export this model and replace it in the Scene Companion editor (keeps id and behaviors)"
    sc_id: bpy.props.StringProperty()

    def execute(self, context):
        coll = _collection_for(self.sc_id)
        if not coll:
            self.report({"ERROR"}, f"No SC collection for {self.sc_id}")
            return {"CANCELLED"}
        try:
            r = send_back(coll, draco=context.scene.sc_draco)
        except Exception as e:
            self.report({"ERROR"}, f"Send Back failed: {e}")
            return {"CANCELLED"}
        _state["status"] = f"sent {self.sc_id} → {r.get('saved')}"
        self.report({"INFO"}, _state["status"])
        return {"FINISHED"}


class SC_PT_panel(bpy.types.Panel):
    bl_label = "Scene Companion"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Scene Companion"

    def draw(self, context):
        col = self.layout.column()
        col.prop(context.scene, "sc_server", text="Server")
        col.operator(SC_OT_toggle.bl_idname, text="Stop" if _state["on"] else "Start", icon="PAUSE" if _state["on"] else "PLAY")
        col.label(text=_state["status"])
        col.prop(context.scene, "sc_draco", text="Draco on Send Back")
        for c in bpy.data.collections:
            if c.get("sc_id"):
                row = col.row()
                row.label(text=f"{c['sc_id']} (all {c['sc_prefab']})" if c.get("sc_prefab") else c["sc_id"], icon="OUTLINER_COLLECTION")
                row.operator(SC_OT_send_back.bl_idname, text="Send Back", icon="EXPORT").sc_id = c["sc_id"]


CLASSES = (SC_OT_toggle, SC_OT_send_back, SC_PT_panel)


def register():
    bpy.types.Scene.sc_server = bpy.props.StringProperty(name="Server", default="http://localhost:8080",
                                                         description="The Scene Companion dev server (npm run dev)")
    bpy.types.Scene.sc_draco = bpy.props.BoolProperty(name="Draco", default=True,
                                                      description="Compress meshes on Send Back (house rule: GLBs under ~20 MB)")
    for c in CLASSES:
        bpy.utils.register_class(c)


def unregister():
    _state["on"] = False
    for c in reversed(CLASSES):
        bpy.utils.unregister_class(c)
    del bpy.types.Scene.sc_server
    del bpy.types.Scene.sc_draco


if __name__ == "__main__":
    register()
