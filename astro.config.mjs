import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://junxuanh.github.io',
  devToolbar: { enabled: false },
  vite: {
    build: { target: 'esnext' },
    // three addons import bare 'three'; point it at the WebGPU build so only one copy of three ships.
    resolve: { alias: [{ find: /^three$/, replacement: 'three/webgpu' }] },
    // Don't pre-bundle three: the optimizer would bake a second copy of the core into the addon chunks.
    optimizeDeps: { exclude: ['three'] },
  },
});
