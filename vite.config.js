import { defineConfig, loadEnv } from 'vite';

// Vite configuration for local dev and GitHub Pages builds.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // For GitHub Pages repo "AutoLoanCalculator", assets need this base.
  // Override by setting VITE_BASE if deploying elsewhere.
  const base = env.VITE_BASE || '/AutoLoanCalculator/';
  return {
    base,
    server: { port: 5173, open: true },
  };
});

