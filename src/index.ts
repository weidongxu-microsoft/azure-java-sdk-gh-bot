import { Application } from 'probot' // eslint-disable-line no-unused-vars
import { request } from '@octokit/request'
import * as url from 'url'

const textAnalyticsKey = process.env['TEXT_ANALYTICS_KEY'] || ''
const textAnalyticsEndPoint = process.env['TEXT_ANALYTICS_ENDPOINT'] || ''

const keywordLibraryUsed = 'Library used:'
const keywordArtifactId = '<artifactId>'

const mapArtifactId2Label = new Map<string, string>([
  ['azure-core', 'azure-core'],
  ['azure-resourcemanager-resources', 'mgmt-resources'],
  ['azure-resourcemanager-storage', 'mgmt-storage'],
  ['azure-resourcemanager-compute', 'mgmt-compute'],
  ['azure-resourcemanager-network', 'mgmt-network']
])

export = (app: Application) => {
  app.on('issues', async (context) => {
    if (context.payload.action == 'opened') {
      const issueComment = context.issue({ body: 'Thanks for opening this issue!' })
      await context.github.issues.createComment(issueComment)
    }

    if (context.payload.action == 'opened' || (context.payload.action == 'edited')) {
      const labels = []

      // by title
      if (context.payload.issue.title.toLowerCase().includes('[feature request]')) {
        labels.push('feature-request')
      } else if (context.payload.issue.title.toLowerCase().includes('[bug]')) {
        labels.push('bug')
      }

      // by artifact id
      const bodyLines = context.payload.issue.body.split('\n', 256)
      for (const line of bodyLines) {
        let sdkName = undefined
        // library used
        if (line.includes(keywordLibraryUsed)) {
          const pos = line.lastIndexOf(keywordLibraryUsed) + keywordLibraryUsed.length
          const subline = line.substring(pos).trim()
          let nextPos = subline.indexOf(' ')
          if (nextPos == -1) {
            nextPos = subline.length
          }
          sdkName = subline.substring(0, nextPos).trim()
        }
        // artifact id
        if (!sdkName && line.includes(keywordArtifactId)) {
          const pos = line.lastIndexOf(keywordLibraryUsed) + keywordLibraryUsed.length
          let nextPos = line.indexOf('</artifactId>', pos)
          if (nextPos == -1) {
            nextPos = line.length
          }
          sdkName = line.substring(pos, nextPos).trim()
        }

        if (sdkName) {
          const label = mapArtifactId2Label.get(sdkName)
          if (label && !labels.includes(label)) {
            labels.push(label)

            app.log(`add label "${label}" via artifact id`)

            if (label.startsWith('mgmt-')) {
              labels.push('mgmt')
            }
          }
        }
      }

      // by key phrases
      if (context.payload.issue.body.length > 100 && context.payload.issue.body.length < 5120) {
        const response = await request({
          method: 'POST',
          url: url.resolve(textAnalyticsEndPoint, '/text/analytics/v2.1/keyPhrases'),
          headers: {
            'Ocp-Apim-Subscription-Key': textAnalyticsKey,
          },
          mediaType: {
            format: 'json'
          },

          documents: [
            {
              'language': 'en',
              'id': Date.now().toString(),
              'text': context.payload.issue.body
            }
          ]
        })
        
        if (response.status == 200) {
          const keyPhrases: string[] = response.data.documents[0].keyPhrases
          app.log(`key phrases found in issue body: ${keyPhrases}`)

          for (const phrase of keyPhrases) {
            const phraseLower = phrase.toLowerCase()
            let label
            if (phraseLower.includes('fluent') || phraseLower.includes('manager') || phraseLower.includes('management')) {
              label = 'mgmt'
            }

            if (label && !labels.includes(label)) {
              labels.push(label)

              app.log(`add label "${label}" via key phrase "${phrase}"`)  
            }
          }
        }
      }

      if (labels.length > 0) {
        const issueAddLabels = context.issue({ labels: labels })
        await context.github.issues.addLabels(issueAddLabels)
      }
    }
  })
}
