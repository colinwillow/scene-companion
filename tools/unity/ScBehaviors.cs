// Scene Companion: the behaviors an object had in the web game, kept as JSON (they run as JavaScript there; a Unity
// script can read them here). Added by Scene Companion › Build Scene.
using UnityEngine;

namespace SceneCompanion
{
    public class ScBehaviors : MonoBehaviour
    {
        [TextArea(3, 20)] public string json;
    }
}
