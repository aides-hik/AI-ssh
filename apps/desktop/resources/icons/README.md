# Prism app icon

The approved icon was generated with Canva for this project:

- Media ID: `MAHZFWEN3qQ`
- [Open generated image](https://www.canva.com/M/MAHZFWEN3qQ)
- `canva-preview.png`: unmodified 200×200 PNG returned by Canva.
- Canva reports a 1264×1264 original, but its connector currently supplies only
  the 200×200 preview, without an original download endpoint. No original detail
  is added by exporting larger platform sizes.

`prism.png` preserves the source resolution and removes the outside black
corners around the rounded tile. It is shared by the application UI, browser
favicon and Electron window. `prism.ico`, `prism.icns` and `prism-linux.png` are
the Windows, macOS and Linux package icons. Their larger representations are
resampled from the same source.

After installing workspace dependencies, regenerate these files from the root:

```sh
node apps/desktop/scripts/generate-app-icons.mjs
```

To improve large desktop icon sharpness, replace `canva-preview.png` with the
original PNG downloaded from Canva and run the same command. The generator
keeps the input resolution.
