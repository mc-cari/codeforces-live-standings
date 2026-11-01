import { defineConfig } from 'astro/config';
export default defineConfig({
 output:'static',
 vite:{build:{assetsInlineLimit:0},server:{proxy:{'/api':{target:process.env.ADMIN_API_TARGET || 'http://127.0.0.1:8081',changeOrigin:false}}}},
});
