# Scene Companion -> Unreal (5.3+). In the Unreal editor: Tools > Execute Python Script... > pick this file.
# (Needs the "Python Editor Script Plugin" and the glTF / Interchange importer, both on by default in UE 5.3+.)
# Reads the *.sc.json beside this file (written by `npm run export:unreal`, already in
# Unreal space: Z up, centimetres), imports every GLB under /Game/SceneCompanion/<scene>/, and places the level:
# models, basic shapes with a coloured material each, lights, hidden collision boxes for Solids, a camera.
# Each actor is tagged "sc:<id>" and its behaviors (JavaScript in the web game) are written to <scene>.behaviors.json.
import json, os, re
import unreal

HERE = os.path.dirname(os.path.abspath(__file__))
tools = unreal.AssetToolsHelpers.get_asset_tools()
actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)


def vec(a):
    return unreal.Vector(float(a[0]), float(a[1]), float(a[2]))


def rot(q):
    return unreal.Quat(float(q[0]), float(q[1]), float(q[2]), float(q[3])).rotator()


def colour(hexs):
    h = (hexs or '#cccccc').lstrip('#')[:6].ljust(6, 'c')
    return unreal.LinearColor(int(h[0:2], 16) / 255.0, int(h[2:4], 16) / 255.0, int(h[4:6], 16) / 255.0, 1.0)


def import_glb(path, dest):
    """Import one GLB; returns the meshes it made (static or skeletal)."""
    task = unreal.AssetImportTask()
    task.filename = path
    task.destination_path = dest
    task.automated = True
    task.save = True
    task.replace_existing = True
    tools.import_asset_tasks([task])
    out = []
    for p in task.imported_object_paths or []:
        obj = unreal.load_asset(p)
        if isinstance(obj, (unreal.StaticMesh, unreal.SkeletalMesh)):
            out.append(obj)
    return out


SHAPES = {'box': '/Engine/BasicShapes/Cube', 'sphere': '/Engine/BasicShapes/Sphere', 'cylinder': '/Engine/BasicShapes/Cylinder',
          'capsule': '/Engine/BasicShapes/Cylinder', 'plane': '/Engine/BasicShapes/Plane'}
_materials = {}


def material(dest, hexs):
    if hexs in _materials:
        return _materials[hexs]
    name = 'M_' + re.sub(r'[^0-9a-fA-F]', '', hexs or 'ccc')
    mi = tools.create_asset(name, dest + '/Materials', unreal.MaterialInstanceConstant, unreal.MaterialInstanceConstantFactoryNew())
    mi.set_editor_property('parent', unreal.load_asset('/Engine/BasicShapes/BasicShapeMaterial'))
    unreal.MaterialEditingLibrary.set_material_instance_vector_parameter_value(mi, 'Color', colour(hexs))
    _materials[hexs] = mi
    return mi


def place(mesh, loc, rotation, scale, label):
    a = actors.spawn_actor_from_object(mesh, loc, rotation)
    a.set_actor_scale3d(scale)
    a.set_actor_label(label)
    return a


def build(path):
    sc = json.load(open(path))
    dest = '/Game/SceneCompanion/' + re.sub(r'[^A-Za-z0-9_]', '_', sc['name'])
    meshes, world_pos, behaviors, made = {}, [], {}, 0
    for n in sc['nodes']:
        # world transform: parent's (children are placed relative to their parent in the web game)
        loc, q = vec(n['pos']), unreal.Quat(*[float(v) for v in n['quat']])
        if n['parent'] >= 0:
            ploc, pq = world_pos[n['parent']]
            loc = ploc + pq.rotate_vector(loc)
            q = pq * q
        world_pos.append((loc, q))
        r = q.rotator()
        if n.get('behaviors') and n['behaviors'] != '[]':
            behaviors[n['name']] = json.loads(n['behaviors'])
        L = n.get('light')
        if L:
            t = L['type']
            if t in ('hemisphere', 'ambient'):
                a = actors.spawn_actor_from_class(unreal.SkyLight, loc, r)
                a.get_component_by_class(unreal.SkyLightComponent).set_editor_property('intensity', float(L.get('intensity') or 1))
            else:
                cls = {'directional': unreal.DirectionalLight, 'spot': unreal.SpotLight}.get(t, unreal.PointLight)
                aim = unreal.MathLibrary.find_look_at_rotation(loc, unreal.Vector(0, 0, 0)) if t == 'directional' else \
                    (unreal.Rotator(0, -90, 0) if t == 'spot' else r)
                a = actors.spawn_actor_from_class(cls, loc, aim)
                comp = a.get_component_by_class(unreal.LightComponent)
                comp.set_editor_property('light_color', colour(L.get('color')).to_color(True))
                comp.set_editor_property('intensity', float(L.get('intensity') or 2) * (3.0 if t == 'directional' else 400.0))
            a.set_actor_label(n['name'])
            a.tags = [unreal.Name('sc:' + n['name'])]
            made += 1
            continue
        m = n.get('model')
        if m:
            f = os.path.join(HERE, m['file'])
            if f not in meshes:
                meshes[f] = import_glb(f, dest + '/' + os.path.dirname(m['file']).replace('\\', '/'))
            off = q.rotate_vector(vec(m['offset']))
            for k, mesh in enumerate(meshes[f]):
                a = place(mesh, loc + off, r, vec([n['scale'][i] * m['scale'][i] for i in range(3)]), n['name'] if k == 0 else n['name'] + '_' + str(k))
                a.tags = [unreal.Name('sc:' + n['name'])]
                made += 1
            if not meshes[f]:
                unreal.log_warning('Scene Companion: %s imported no mesh' % m['file'])
        p = n.get('primitive')
        if p:
            shape = unreal.load_asset(SHAPES.get(p['kind'], SHAPES['box']))
            size = list(p['size'])
            if p['kind'] == 'plane':
                size[2] = 1.0
            a = place(shape, loc + q.rotate_vector(unreal.Vector(0, 0, float(p.get('lift', 0)))), r,
                      vec([n['scale'][i] * size[i] for i in range(3)]), n['name'])
            a.static_mesh_component.set_material(0, material(dest, p.get('color')))
            a.tags = [unreal.Name('sc:' + n['name'])]
            made += 1
        for s in n.get('solids') or []:
            cube = unreal.load_asset(SHAPES['box'])
            a = place(cube, loc + q.rotate_vector(vec(s['center'])), r, vec(s['size']), n['name'] + '_collider')
            a.set_actor_hidden_in_game(True)
            a.tags = [unreal.Name('sc:' + n['name']), unreal.Name('sc:collider')]
    # a camera behind the player (the game's follow cam: up 3.5 m, 7 m back along the web game's +z = Unreal's +X)
    player = next((i for i, n in enumerate(sc['nodes']) if n['name'] == sc.get('player', 'player')), None)
    at = world_pos[player][0] if player is not None else unreal.Vector(0, 0, 0)
    cam_loc = at + unreal.Vector(700, 0, 350)
    cam = actors.spawn_actor_from_class(unreal.CameraActor, cam_loc, unreal.MathLibrary.find_look_at_rotation(cam_loc, at + unreal.Vector(0, 0, 130)))
    cam.set_actor_label('SceneCompanion_Camera')
    out = os.path.join(HERE, sc['name'] + '.behaviors.json')
    json.dump(behaviors, open(out, 'w'), indent=1)
    unreal.log('Scene Companion: built %s (%d actors); behaviors -> %s' % (sc['name'], made, out))


for f in sorted(os.listdir(HERE)):
    if f.endswith('.sc.json'):
        build(os.path.join(HERE, f))
