const {GraphQLClient} = require('graphql-request')
const ora = require('ora')

const parse = require('date-fns/parse')
const subDays = require('date-fns/sub_days')
const isBefore = require('date-fns/is_before')
const isAfter = require('date-fns/is_after')
const format = require('date-fns/format')
const distanceInWordsStrict = require('date-fns/distance_in_words_strict')

const {padEnd, each, zip, keys, values} = require('lodash/fp')

const args = require('yargs')
    .coerce({
        'start-date': Date.parse,
        'end-date': Date.parse
    })
    .option('start-date', {default: subDays(new Date(), 7)})
    .option('end-date', {default: subDays(new Date(), 0)})
    .option('repo-name', {required: true})
    .option('repo-owner', {required: true})
    .option('token').argv

const token = process.env.GH_TOKEN

let headers = {}
if (args.token) {
    headers = {Authorization: `Bearer ${args.token}`}
}

const client = new GraphQLClient('https://api.github.com/graphql', {
    headers
})

const query = `
query getPullRequests($name: String!, $owner: String!) {
  repository(name: $name, owner: $owner) {
    pullRequests(first:100,  orderBy: {field: CREATED_AT, direction: DESC}, baseRefName: "staging", states: [MERGED]) {
      nodes {
        number
        author {
          login
        }
        state
        mergedAt
        createdAt
        title
        changedFiles
      }
    }
  }
}
`

const main = async () => {
    const spinner = ora('Analysing pull requests').start()
    const data = await client.request(query, {
        name: args.repoName,
        owner: args.repoOwner
    })
    spinner.succeed()
    const startDate = args.startDate
    const endDate = args.endDate

    const prs = data.repository.pullRequests.nodes.filter(node => {
        const createdAt = parse(node.createdAt)
        return isBefore(createdAt, endDate) && isAfter(createdAt, startDate)
    })

    console.log('')
    console.log('Info:')
    console.log('  Owner           =>', args.repoOwner)
    console.log('  Repository name =>', args.repoName)
    console.log('  From            =>', format(args.startDate, 'YYYY-MM-DD'))
    console.log('  To              =>', format(args.endDate, 'YYYY-MM-DD'))
    console.log('  Total           =>', prs.length)

    console.log('')
    console.log('Count by author:')
    const authors = prs.reduce((owners, pr) => {
        const login = pr.author.login
        if (owners[login]) {
            owners[login]++
        } else {
            owners[login] = 1
        }
        return owners
    }, {})
    const longestName = Math.max(...Object.keys(authors).map(a => a.length))
    each(([name, count]) => {
        console.log(' ', padEnd(longestName, name), '=>', count)
    }, zip(keys(authors), values(authors)))

    console.log('')
    console.log('Time to merge:')
    const shortest = prs.reduce((a, b) => {
        if (!a) return b
        const aOpenTime = new Date(a.mergedAt) - new Date(a.createdAt)
        const bOpenTime = new Date(b.mergedAt) - new Date(b.createdAt)

        if (bOpenTime < aOpenTime) return b
        return a
    }, null)
    const longest = prs.reduce((a, b) => {
        if (!a) return b
        const aOpenTime = new Date(a.mergedAt) - new Date(a.createdAt)
        const bOpenTime = new Date(b.mergedAt) - new Date(b.createdAt)

        if (bOpenTime > aOpenTime) return b
        return a
    }, null)
    console.log(
        '  Shortest     =>',
        distanceInWordsStrict(shortest.createdAt, shortest.mergedAt),
        `(#${shortest.number})`
    )
    console.log(
        '  Longest      =>',
        distanceInWordsStrict(longest.createdAt, longest.mergedAt),
        `(#${longest.number})`
    )

    const total = prs.reduce((a, b) => {
        const openTime = new Date(b.mergedAt) - new Date(b.createdAt)
        return a + openTime
    }, 0)
    const meanInMs = total / prs.length
    const now = Date.now()
    const fut = now + meanInMs
    console.log('  Mean (days)  =>', distanceInWordsStrict(now, fut))
    console.log(
        '  Mean (hours) =>',
        distanceInWordsStrict(now, fut, {unit: 'h'})
    )
}

main().catch(console.error)
