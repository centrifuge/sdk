// @ts-check
import url from 'node:url'
import { MarkdownPageEvent } from 'typedoc-plugin-markdown'
import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * @param {import('typedoc-plugin-markdown').MarkdownApplication} app
 */
export function load(app) {
  app.renderer.on(MarkdownPageEvent.END, (page) => {
    page.contents = page.contents
      ?.replace(/(^.*?)(?=\n?#\s)/s, '')
      .replace(/^(# .*)(\\<.*?>)/m, (_, heading) => heading.replace(/\\<.*?>/, '').trim())
      .replace('# Type Alias', '# Type')
      .replaceAll('# ', '## ')
    page.filename = page.filename?.replace(/\/([^\/]+)$/, '/_$1')
    page.contents = rewriteMarkdownLinks(page.contents ?? '', page.url)
  })

  app.renderer.postRenderAsyncJobs.push(async (renderer) => {
    console.log(renderer.urls?.map((u) => u.url).join('\n'))

    try {
      // Delete the README.md
      await fs.unlink(path.join(process.cwd(), 'docs', '_README.md'))
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('Error deleting README.md:', error)
      }
    }
  })
}

/**
 * @param {string} markdownContent
 * @param {string} pageUrl
 */
function rewriteMarkdownLinks(markdownContent, pageUrl) {
  const linkRegex = /\[([^\]]+)\]\(([^)]+\.md)\)/g
  const markdown = markdownContent.replace(linkRegex, (_, linkName, relativePath) => {
    const resolvedUrl = url
      .resolve(pageUrl, relativePath)
      .replace(/\.md$/, '')
      .replace(/:/, '')
      .replace(/[\s\/]/, '-')
      .replace(/^classes/, 'class')
      .replace(/^type-aliases/, 'type')
      .toLowerCase()

    return `[${linkName}](#${resolvedUrl})`
  })

  return markdown
}
