// @ts-check
import url from 'node:url'
import { MarkdownPageEvent } from 'typedoc-plugin-markdown'

/**
 * @param {import('typedoc-plugin-markdown').MarkdownApplication} app
 */
export function load(app) {
  app.renderer.on(MarkdownPageEvent.END, (page) => {
    page.contents = page.contents
      // Remove the noise before the first heading
      ?.replace(/(^.*?)(?=\n?#\s)/s, '')
      // Remove generic type parameters from headings
      .replace(/^(# .*)(\\<.*?>)/m, (_, heading) => heading.replace(/\\<.*?>/, '').trim())
      .replace('# Type Alias', '# Type')
      // Increase the heading levels by one
      .replaceAll('# ', '## ')
    page.filename = page.filename?.replace(/\/([^\/]+)$/, '/_$1')
    page.contents = rewriteMarkdownLinks(page.contents ?? '', page.url)
  })
  app.renderer.postRenderAsyncJobs.push(async (renderer) => {
    // Log the paths in a way that can be easily used with Slate
    console.log(renderer.urls?.map((u) => u.url.replace(/\.md$/, '')).join('\n'))
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
