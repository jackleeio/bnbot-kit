import 'server-only';

import fs from 'node:fs';
import path from 'node:path';

export type BlogFrontmatter = {
  title: string;
  description: string;
  excerpt: string;
  date: string;
  tags?: string[];
  coverImage?: string;
};

export type BlogPost = BlogFrontmatter & {
  slug: string;
  content: string;
};

export type BlogPostSummary = BlogFrontmatter & {
  slug: string;
};

const BLOG_CONTENT_DIR = path.join(process.cwd(), 'src/content/blog');
const BLOG_POST_EXTENSION = '.md';
const SITE_URL = process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'https://bnbot.ai';

function assertContentDirectoryExists() {
  if (!fs.existsSync(BLOG_CONTENT_DIR)) {
    throw new Error(`Blog content directory not found: ${BLOG_CONTENT_DIR}`);
  }
}

function parseFrontmatterValue(rawValue: string): string {
  const value = rawValue.trim();

  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  return value;
}

function parseTags(raw?: string): string[] | undefined {
  if (!raw) return undefined;

  // Supports either CSV: a,b,c or [a, b, c]
  const normalized = raw.replace(/^\[/, '').replace(/\]$/, '');
  const tags = normalized
    .split(',')
    .map((item) => item.trim())
    .map((item) => item.replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);

  return tags.length ? tags : undefined;
}

function parseMarkdownDocument(fileContent: string): BlogFrontmatter & { content: string } {
  const normalizedContent = fileContent.replace(/\r\n/g, '\n');

  if (!normalizedContent.startsWith('---\n')) {
    throw new Error('Blog post is missing frontmatter.');
  }

  const frontmatterEndIndex = normalizedContent.indexOf('\n---\n', 4);

  if (frontmatterEndIndex === -1) {
    throw new Error('Blog post has an unterminated frontmatter block.');
  }

  const frontmatterBlock = normalizedContent.slice(4, frontmatterEndIndex);
  const markdownContent = normalizedContent.slice(frontmatterEndIndex + 5).trim();
  const entries = frontmatterBlock
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const separatorIndex = line.indexOf(':');

      if (separatorIndex === -1) {
        throw new Error(`Invalid frontmatter line: ${line}`);
      }

      const key = line.slice(0, separatorIndex).trim();
      const value = parseFrontmatterValue(line.slice(separatorIndex + 1));

      return [key, value] as const;
    });

  const frontmatter = Object.fromEntries(entries);
  const title = frontmatter.title;
  const description = frontmatter.description;
  const excerpt = frontmatter.excerpt;
  const date = frontmatter.date;

  if (!title || !description || !excerpt || !date) {
    throw new Error('Blog post frontmatter must include title, description, excerpt, and date.');
  }

  if (Number.isNaN(Date.parse(date))) {
    throw new Error(`Blog post has an invalid date: ${date}`);
  }

  return {
    title,
    description,
    excerpt,
    date,
    tags: parseTags(frontmatter.tags),
    coverImage: frontmatter.coverImage,
    content: markdownContent,
  };
}

function readAllMarkdownFilesRecursively(dirPath: string): string[] {
  const items = fs.readdirSync(dirPath, { withFileTypes: true });
  const files: string[] = [];

  for (const item of items) {
    const fullPath = path.join(dirPath, item.name);

    if (item.isDirectory()) {
      files.push(...readAllMarkdownFilesRecursively(fullPath));
      continue;
    }

    if (item.isFile() && fullPath.endsWith(BLOG_POST_EXTENSION)) {
      files.push(fullPath);
    }
  }

  return files;
}

function relativeMarkdownPathToSlug(relativePath: string): string {
  return relativePath
    .slice(0, -BLOG_POST_EXTENSION.length)
    .replace(/\\/g, '/')
    .replace(/\//g, '--')
    .toLowerCase();
}

function readBlogPostFile(absolutePath: string): BlogPost {
  const relativePath = path.relative(BLOG_CONTENT_DIR, absolutePath);
  const slug = relativeMarkdownPathToSlug(relativePath);
  const fileContent = fs.readFileSync(absolutePath, 'utf8');
  const parsedPost = parseMarkdownDocument(fileContent);

  return {
    slug,
    ...parsedPost,
  };
}

export function getBlogPosts(): BlogPostSummary[] {
  assertContentDirectoryExists();

  return readAllMarkdownFilesRecursively(BLOG_CONTENT_DIR)
    .map(readBlogPostFile)
    .sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime())
    .map(({ content: _content, ...summary }) => summary);
}

export function getBlogPostBySlug(slug: string): BlogPost | null {
  assertContentDirectoryExists();

  const posts = readAllMarkdownFilesRecursively(BLOG_CONTENT_DIR).map(readBlogPostFile);

  // 1) exact slug match
  const exact = posts.find((post) => post.slug === slug);
  if (exact) return exact;

  // 2) friendly short slug support (e.g. /blog/ai-2026-02-28)
  //    for files stored as /yyyy/mm/slug.md -> yyyy--mm--slug
  const suffixMatch = posts.find((post) => post.slug.endsWith(`--${slug}`));
  if (suffixMatch) return suffixMatch;

  return null;
}

export function getBlogPostSlugs(): string[] {
  return getBlogPosts().map((post) => post.slug);
}

export function formatBlogDate(date: string): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(date));
}

export function getBlogPostUrl(slug: string): string {
  return `${SITE_URL}/blog/${slug}`;
}

export function getBlogIndexUrl(): string {
  return `${SITE_URL}/blog`;
}

export function getBlogPostsByTag(tag: string): BlogPostSummary[] {
  const normalized = tag.trim().toLowerCase();
  return getBlogPosts().filter((post) => (post.tags || []).map((t) => t.toLowerCase()).includes(normalized));
}

export function extractFaqFromMarkdown(content: string): Array<{ question: string; answer: string }> {
  const lines = content.split('\n');
  const faqs: Array<{ question: string; answer: string }> = [];

  let inFaq = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();

    if (/^##\s+faq/i.test(line)) {
      inFaq = true;
      continue;
    }

    if (inFaq && /^##\s+/.test(line) && !/^##\s+faq/i.test(line)) {
      break;
    }

    if (inFaq && /^###\s+/.test(line)) {
      const question = line.replace(/^###\s+/, '').trim();
      const answerLines: string[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const next = lines[j].trim();
        if (/^###\s+/.test(next) || /^##\s+/.test(next)) break;
        if (next) answerLines.push(next);
        j += 1;
      }
      if (question && answerLines.length) {
        faqs.push({ question, answer: answerLines.join(' ') });
      }
    }
  }

  return faqs;
}
