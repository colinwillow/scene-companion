// Scene Companion → Unity. Menu: Scene Companion › Build Scene. Reads every Assets/SceneCompanion/*.sc.json (written by
// `npm run export:unity`) and builds it into the open scene: models (the GLBs, imported by glTFast), primitives with a
// material each, lights, BoxColliders for Solids, and an ScBehaviors component holding each object's behaviors as JSON.
// Positions are already in Unity's space (the exporter mirrors X the way glTFast does).
using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;

namespace SceneCompanion
{
    [System.Serializable] public class ScModel { public string file; public float[] scale; public float[] offset; }
    [System.Serializable] public class ScPrim { public string kind; public float[] size; public string color; public float lift; }
    [System.Serializable] public class ScLight { public string type; public string color; public float intensity; public float distance; public float angle; public bool shadows; }
    [System.Serializable] public class ScSolid { public float[] center; public float[] size; }
    [System.Serializable] public class ScNode { public string name; public int parent; public float[] pos; public float[] quat; public float[] scale; public ScModel model; public ScPrim primitive; public ScLight light; public List<ScSolid> solids; public string behaviors; }
    [System.Serializable] public class ScScene { public string name; public string background; public bool sky; public string player; public List<ScNode> nodes; }

    public static class Importer
    {
        const string Root = "Assets/SceneCompanion/";

        [MenuItem("Scene Companion/Build Scene")]
        public static void Build()
        {
            var files = Directory.GetFiles(Root, "*.sc.json");
            if (files.Length == 0) { Debug.LogWarning("Scene Companion: no *.sc.json in " + Root); return; }
            foreach (var f in files) BuildOne(f);
            EditorSceneManager.MarkSceneDirty(EditorSceneManager.GetActiveScene());
        }

        static Vector3 V(float[] a, float d = 0) => a != null && a.Length >= 3 ? new Vector3(a[0], a[1], a[2]) : new Vector3(d, d, d);
        static Color Col(string hex) { return ColorUtility.TryParseHtmlString(hex ?? "#cccccc", out var c) ? c : Color.gray; }

        static void BuildOne(string path)
        {
            var sc = JsonUtility.FromJson<ScScene>(File.ReadAllText(path));
            var root = new GameObject(sc.name);
            Undo.RegisterCreatedObjectUndo(root, "Scene Companion build");
            var made = new List<GameObject>();
            Directory.CreateDirectory(Root + "Materials");
            foreach (var n in sc.nodes)
            {
                var go = new GameObject(n.name);
                go.transform.SetParent(n.parent >= 0 ? made[n.parent].transform : root.transform, false);
                go.transform.localPosition = V(n.pos);
                if (n.quat != null && n.quat.Length == 4) go.transform.localRotation = new Quaternion(n.quat[0], n.quat[1], n.quat[2], n.quat[3]);
                go.transform.localScale = V(n.scale, 1);
                made.Add(go);

                if (n.light != null && !string.IsNullOrEmpty(n.light.type)) AddLight(go, n.light, root.transform);
                if (n.model != null && !string.IsNullOrEmpty(n.model.file))
                {
                    var asset = AssetDatabase.LoadAssetAtPath<GameObject>(Root + n.model.file);
                    if (asset == null) Debug.LogWarning($"Scene Companion: {n.model.file} did not import — is glTFast installed (com.unity.cloud.gltfast)?");
                    else
                    {
                        var inst = (GameObject)PrefabUtility.InstantiatePrefab(asset);
                        inst.transform.SetParent(go.transform, false);
                        inst.transform.localPosition = V(n.model.offset);
                        inst.transform.localScale = V(n.model.scale, 1);
                    }
                }
                if (n.primitive != null && !string.IsNullOrEmpty(n.primitive.kind)) AddPrimitive(go, n.primitive, n.name);
                if (n.solids != null) foreach (var s in n.solids) { var bc = go.AddComponent<BoxCollider>(); bc.center = V(s.center); bc.size = V(s.size, 1); }
                if (!string.IsNullOrEmpty(n.behaviors) && n.behaviors != "[]") go.AddComponent<ScBehaviors>().json = n.behaviors;
            }

            // a camera behind the player (or the origin), the background colour
            var cam = Camera.main;
            if (cam == null) { var cgo = new GameObject("Main Camera"); cgo.tag = "MainCamera"; cam = cgo.AddComponent<Camera>(); }
            var target = made.Find(g => g.name == (string.IsNullOrEmpty(sc.player) ? "player" : sc.player));
            var at = target != null ? target.transform.position : Vector3.zero;
            cam.transform.position = at + new Vector3(0, 3.5f, 7f);       // the game's follow cam sits on +z, looking back down -z (mirroring X keeps z)
            cam.transform.LookAt(at + Vector3.up * 1.3f);
            if (!sc.sky) { cam.clearFlags = CameraClearFlags.SolidColor; cam.backgroundColor = Col(sc.background); }
            Selection.activeGameObject = root;
            Debug.Log($"Scene Companion: built {sc.name} ({sc.nodes.Count} objects)");
        }

        static void AddLight(GameObject go, ScLight L, Transform root)
        {
            if (L.type == "hemisphere" || L.type == "ambient")
            {
                RenderSettings.ambientMode = AmbientMode.Flat;
                RenderSettings.ambientLight = Col(L.color) * Mathf.Max(0.2f, L.intensity * 0.6f);
                return;
            }
            var l = go.AddComponent<Light>();
            l.color = Col(L.color);
            if (L.type == "directional") { l.type = LightType.Directional; l.intensity = L.intensity / 2f; l.shadows = L.shadows ? LightShadows.Soft : LightShadows.None; go.transform.LookAt(root.position); }
            else if (L.type == "spot") { l.type = LightType.Spot; l.intensity = L.intensity / 15f; l.range = L.distance; l.spotAngle = L.angle * 2f; go.transform.rotation = Quaternion.LookRotation(Vector3.down); }
            else { l.type = LightType.Point; l.intensity = L.intensity / 15f; l.range = L.distance; }
        }

        static void AddPrimitive(GameObject go, ScPrim P, string name)
        {
            var kind = P.kind == "sphere" ? PrimitiveType.Sphere : P.kind == "cylinder" ? PrimitiveType.Cylinder : P.kind == "capsule" ? PrimitiveType.Capsule : P.kind == "plane" ? PrimitiveType.Plane : PrimitiveType.Cube;
            var m = GameObject.CreatePrimitive(kind);
            Object.DestroyImmediate(m.GetComponent<Collider>());      // collision comes from the Solids, as in the game
            m.name = "mesh";
            m.transform.SetParent(go.transform, false);
            var s = V(P.size, 1);
            // Unity's built-ins: cube 1, sphere ⌀1, cylinder and capsule 2 tall ⌀1, plane 10 × 10
            m.transform.localScale = kind == PrimitiveType.Plane ? new Vector3(s.x / 10f, 1, s.z / 10f)
                : kind == PrimitiveType.Cylinder || kind == PrimitiveType.Capsule ? new Vector3(s.x, s.y / 2f, s.x)
                : kind == PrimitiveType.Sphere ? new Vector3(s.x, s.x, s.x) : s;
            m.transform.localPosition = new Vector3(0, P.lift, 0);
            var r = m.GetComponent<Renderer>();
            var mat = new Material(r.sharedMaterial) { color = Col(P.color) };     // the render pipeline's own default, tinted
            var matPath = AssetDatabase.GenerateUniqueAssetPath(Root + "Materials/" + name + ".mat");
            AssetDatabase.CreateAsset(mat, matPath);
            r.sharedMaterial = mat;
        }
    }
}
