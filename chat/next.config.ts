import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Le store et le .env vivent à la racine du dépôt : lus côté serveur uniquement (route /api/chat).
  serverExternalPackages: ['@notionhq/client'],
};

export default nextConfig;
