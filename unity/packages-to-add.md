# Package Manager entries

Paste these into `Packages/manifest.json` under `"dependencies"` (versions
are a known-good set for Unity 2022.3 / Unity 6 — let the editor upgrade
them if it offers):

```json
"com.unity.nuget.newtonsoft-json": "3.2.1",
"com.unity.render-pipelines.universal": "14.0.11",
"com.unity.inputsystem": "1.7.0",
"com.unity.xr.management": "4.4.0",
"com.unity.xr.openxr": "1.11.0",
"com.unity.xr.hands": "1.4.0",
"com.unity.xr.interaction.toolkit": "3.0.3"
```

Then, in **Project Settings ▸ XR Plug-in Management ▸ OpenXR** (Android tab):

- Enable **OpenXR**.
- Interaction profiles: **Oculus Touch Controller Profile** + **Hand
  Interaction Profile**.
- OpenXR Feature Groups: **Meta Quest Support**.
- Features: enable **Hand Tracking Subsystem**.

Player Settings ▸ Android:

- Minimum API Level 32+, Scripting Backend IL2CPP, ARM64 only.
- Active Input Handling: **Both** (or Input System).
