# A stand-in for Unreal's `unreal` Python module: just enough to run tools/unreal/scene_companion_build.py outside the
# editor and record what it would do (tests/engines.test.mjs reads SPAWNS back). Quaternion maths is real.
import json, math, os
SPAWNS = []


class Vector:
    def __init__(self, x=0.0, y=0.0, z=0.0): self.x, self.y, self.z = float(x), float(y), float(z)
    def __add__(self, o): return Vector(self.x + o.x, self.y + o.y, self.z + o.z)
    def tolist(self): return [round(self.x, 4), round(self.y, 4), round(self.z, 4)]


class Rotator:
    def __init__(self, roll=0.0, pitch=0.0, yaw=0.0): self.roll, self.pitch, self.yaw = roll, pitch, yaw


class Quat:
    def __init__(self, x=0.0, y=0.0, z=0.0, w=1.0): self.x, self.y, self.z, self.w = x, y, z, w
    def __mul__(a, b):   # a * b: b first, then a (FQuat's order)
        return Quat(a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y, a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
                    a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w, a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z)
    def rotate_vector(self, v):
        q, p = self, Quat(v.x, v.y, v.z, 0)
        r = q * p * Quat(-q.x, -q.y, -q.z, q.w)
        return Vector(r.x, r.y, r.z)
    def rotator(self): return Rotator()


class LinearColor:
    def __init__(self, r, g, b, a=1.0): self.r, self.g, self.b, self.a = r, g, b, a
    def to_color(self, srgb): return (self.r, self.g, self.b)


class Name(str): pass


class _Obj:
    def __init__(self, path=''): self.path, self.props = path, {}
    def set_editor_property(self, k, v): self.props[k] = v


class StaticMesh(_Obj): pass
class SkeletalMesh(_Obj): pass
class MaterialInstanceConstant(_Obj): pass
class MaterialInstanceConstantFactoryNew: pass
class SkyLight: pass
class SkyLightComponent: pass
class DirectionalLight: pass
class SpotLight: pass
class PointLight: pass
class LightComponent: pass
class CameraActor: pass


class AssetImportTask:
    def __init__(self): self.filename = self.destination_path = None; self.imported_object_paths = []


class _Tools:
    def import_asset_tasks(self, tasks):
        for t in tasks:
            assert os.path.exists(t.filename), t.filename
            t.imported_object_paths = [t.destination_path + '/' + os.path.basename(t.filename) + ':mesh']
    def create_asset(self, name, path, cls, factory): return cls(path + '/' + name)


class AssetToolsHelpers:
    @staticmethod
    def get_asset_tools(): return _Tools()


def load_asset(p): return SkeletalMesh(p) if 'zap' in p else StaticMesh(p)


class _Comp:
    def __init__(self): self.props = {}; self.materials = []
    def set_editor_property(self, k, v): self.props[k] = v
    def set_material(self, i, m): self.materials.append(m.path)


class _Actor:
    def __init__(self, what, loc):
        self.rec = {'what': what, 'loc': loc.tolist(), 'scale': None, 'label': None, 'hidden': False, 'tags': [], 'material': None}
        self.static_mesh_component = _Comp(); self._comp = _Comp(); SPAWNS.append(self)
    def set_actor_scale3d(self, s): self.rec['scale'] = s.tolist()
    def set_actor_label(self, l): self.rec['label'] = l
    def set_actor_hidden_in_game(self, h): self.rec['hidden'] = h
    def get_component_by_class(self, c): return self._comp
    @property
    def tags(self): return self.rec['tags']
    @tags.setter
    def tags(self, t): self.rec['tags'] = [str(x) for x in t]


class _Actors:
    def spawn_actor_from_object(self, obj, loc, rot): return _Actor(obj.path, loc)
    def spawn_actor_from_class(self, cls, loc, rot): return _Actor(cls.__name__, loc)


def get_editor_subsystem(cls): return _Actors()
class EditorActorSubsystem: pass


class MathLibrary:
    @staticmethod
    def find_look_at_rotation(a, b): return Rotator()


class MaterialEditingLibrary:
    @staticmethod
    def set_material_instance_vector_parameter_value(mi, name, value): mi.props[name] = value


def log(m): pass
def log_warning(m): print('WARN', m)


import atexit
atexit.register(lambda: open(os.environ.get('SC_SPAWNS', '/dev/null'), 'w').write(json.dumps([a.rec for a in SPAWNS])))
