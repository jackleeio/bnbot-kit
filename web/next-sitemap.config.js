/** @type {import('next-sitemap').IConfig} */
const fs = require('node:fs');
const path = require('node:path');

const blogContentDir = path.join(process.cwd(), 'src/content/blog');

function readAllMarkdownFilesRecursively(dirPath) {
  if (!fs.existsSync(dirPath)) return [];

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...readAllMarkdownFilesRecursively(fullPath));
      continue;
    }

    if (entry.isFile() && fullPath.endsWith('.md')) {
      files.push(fullPath);
    }
  }

  return files;
}

function getBlogRoutes() {
  return readAllMarkdownFilesRecursively(blogContentDir).map((absolutePath) => {
    const relativePath = path.relative(blogContentDir, absolutePath);
    const slug = relativePath
      .replace(/\\/g, '/')
      .replace(/\.md$/, '')
      .replace(/\//g, '--')
      .toLowerCase();

    return `/blog/${slug}`;
  });
}

module.exports = {
  siteUrl: process.env.SITE_URL || 'https://bnbot.ai',
  generateRobotsTxt: false, // We already have a custom robots.txt
  generateIndexSitemap: true,
  outDir: 'public',
  exclude: [
    '/api/*',
    '/_next/*',
    '/admin/*',
    '/private/*',
    '/profile/*',
    '/gallery/*',
    '/help-center/*',
    '/chat/*', // Exclude chat pages from static sitemap due to auth requirements
  ],
  changefreq: 'weekly',
  priority: 0.8,
  autoLastmod: true,
  
  // Custom transform for better SEO priorities
  transform: async (config, path) => {
    // Higher priority for main pages
    const highPriorityPages = [
      { loc: '/', priority: 1.0, changefreq: 'daily' },
      { loc: '/agent', priority: 1.0, changefreq: 'daily' },
      { loc: '/blog', priority: 0.8, changefreq: 'weekly' },
      { loc: '/chat', priority: 0.9, changefreq: 'daily' },
      { loc: '/boost', priority: 0.8, changefreq: 'weekly' },
      { loc: '/balance', priority: 0.7, changefreq: 'weekly' },
      { loc: '/task', priority: 0.7, changefreq: 'weekly' },
      { loc: '/credits', priority: 0.6, changefreq: 'weekly' },
      { loc: '/deep-research', priority: 0.8, changefreq: 'weekly' },
      ...getBlogRoutes().map((loc) => ({
        loc,
        priority: 0.7,
        changefreq: 'weekly',
      })),
    ];
    
    for (const page of highPriorityPages) {
      if (path === page.loc) {
        return {
          loc: path,
          changefreq: page.changefreq,
          priority: page.priority,
          lastmod: config.autoLastmod ? new Date().toISOString() : undefined,
          alternateRefs: config.alternateRefs ?? [],
        };
      }
    }
    
    // Lower priority for utility pages
    if (path.includes('/help-center') || path.includes('/notification')) {
      return {
        loc: path,
        changefreq: 'monthly',
        priority: 0.4,
        lastmod: config.autoLastmod ? new Date().toISOString() : undefined,
        alternateRefs: config.alternateRefs ?? [],
      };
    }
    
    // Default behavior
    const customPriorities = {
      '/': 1.0,
      '/agent': 1.0,
      '/blog': 0.8,
      '/chat': 0.9,
      '/boost': 0.8,
      '/deep-research': 0.8,
      '/balance': 0.7,
      '/task': 0.7,
      '/credits': 0.6,
    };
    
    return {
      loc: path,
      changefreq: config.changefreq,
      priority: customPriorities[path] || config.priority,
      lastmod: config.autoLastmod ? new Date().toISOString() : undefined,
      alternateRefs: config.alternateRefs ?? [],
    };
  },
};
