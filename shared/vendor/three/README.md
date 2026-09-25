# three.js r170 (vendored)

The arcade has no build step and no runtime dependencies, so the 3D cabinets load
three.js from here rather than a CDN. MIT licensed — see `LICENSE`.

Only the addons the arcade actually uses are copied, straight from
`three@0.170.0/examples/jsm/` with their relative imports intact. Pages map the
bare `three` specifier with an import map:

```html
<script type="importmap">
{ "imports": { "three": "../shared/vendor/three/three.module.min.js",
               "three/addons/": "../shared/vendor/three/addons/" } }
</script>
```

To upgrade: `npm pack three@<ver>`, replace `three.module.min.js`, and re-copy the
same addon files.
