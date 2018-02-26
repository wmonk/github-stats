const {GraphQLClient} = require('graphql-request')
const ora = require('ora')
const percentile = require('percentile')
const colors = require('colors/safe')

const parse = require('date-fns/parse')
const subDays = require('date-fns/sub_days')
const isBefore = require('date-fns/is_before')
const isAfter = require('date-fns/is_after')
const format = require('date-fns/format')
const distanceInWordsStrict = require('date-fns/distance_in_words_strict')

const {padEnd, each, zip, keys, values} = require('lodash/fp')

const median = values => {
    values.sort(function(a, b) {
        return a - b
    })

    var half = Math.floor(values.length / 2)

    if (values.length % 2) return values[half]
    else return (values[half - 1] + values[half]) / 2.0
}

const logBlock = t => {
    const lines = []
    const emptyLines = []
    return {
        log: (...args) => lines.push(args),
        logEmpty: (...args) => emptyLines.push(args),
        end: () => {
            console.log('')
            console.log(colors.green.bold(`${t}:`))
            const maxLength = lines.reduce((length, [line]) => {
                if (line.length > length) return line.length
                return length
            }, 0)
            each(([name, ...rest]) => {
                console.log(' ', padEnd(maxLength, name), '=>', ...rest)
            }, lines)

            each((line) => {
                console.log(' ', ...line)
            }, emptyLines)

            console.log('')
        }
    }
}

const args = require('yargs')
    .coerce({
        'start-date': Date.parse,
        'end-date': Date.parse
    })
    .option('start-date', {default: subDays(new Date(), 7)})
    .option('end-date', {default: subDays(new Date(), 0)})
    .option('repo-name', {required: true})
    .option('repo-owner', {required: true})
    .option('base-branch', {default: 'master'})
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
query getPullRequests($name: String!, $owner: String!, $baseBranch: String!) {
  repository(name: $name, owner: $owner) {
    pullRequests(first:100,  orderBy: {field: UPDATED_AT, direction: DESC}, baseRefName: $baseBranch, states: [MERGED]) {
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
        owner: args.repoOwner,
        baseBranch: args.baseBranch
    })
    spinner.succeed()
    const startDate = args.startDate
    const endDate = args.endDate

    const prs = data.repository.pullRequests.nodes.filter(node => {
        const mergedAt = parse(node.mergedAt)
        return isBefore(mergedAt, endDate) && isAfter(mergedAt, startDate)
    })

    const infoBlock = logBlock('Info')
    infoBlock.log('Owner', args.repoOwner)
    infoBlock.log('Repository name', args.repoName)
    infoBlock.log('From', format(args.startDate, 'YYYY-MM-DD'))
    infoBlock.log('To', format(args.endDate, 'YYYY-MM-DD'))
    infoBlock.log('Total', prs.length)
    infoBlock.end()

    const prBlock = logBlock('Pull requests')
    const now = Date.now()
    const f = prs.map(a => a).sort((a, b) => {
        const aOpenTime = new Date(a.mergedAt) - new Date(a.createdAt)
        const bOpenTime = new Date(b.mergedAt) - new Date(b.createdAt)
        return aOpenTime - bOpenTime
    })
    f.map(pr => {
        const openTime = new Date(pr.mergedAt) - new Date(pr.createdAt)
        prBlock.logEmpty(
            pr.title,
            `- ${distanceInWordsStrict(now, now + openTime)}`,
            `(#${pr.number})`,
        )
    })
    prBlock.end()

    const authorBlock = logBlock('Count by author')
    const authors = prs.reduce((owners, pr) => {
        const login = pr.author.login
        if (owners[login]) {
            owners[login]++
        } else {
            owners[login] = 1
        }
        return owners
    }, {})

    each(([name, count]) => authorBlock.log(name, count), zip(keys(authors), values(authors)))
    authorBlock.end()


    const mergeBlock = logBlock('Time to merge')
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
    mergeBlock.log(
        'Shortest',
        distanceInWordsStrict(shortest.createdAt, shortest.mergedAt),
        `(#${shortest.number})`
    )
    mergeBlock.log(
        'Longest',
        distanceInWordsStrict(longest.createdAt, longest.mergedAt),
        `(#${longest.number})`
    )

    const total = prs.reduce((a, b) => {
        const openTime = new Date(b.mergedAt) - new Date(b.createdAt)
        return a + openTime
    }, 0)
    const meanInMs = total / prs.length
    const fut = now + meanInMs
    mergeBlock.log('Mean (days)', distanceInWordsStrict(now, fut))
    mergeBlock.log(
        'Mean (hours)',
        distanceInWordsStrict(now, fut, {unit: 'h'})
    )

    const allTimes = prs.map(pr => {
        const openTime = new Date(pr.mergedAt) - new Date(pr.createdAt)
        return openTime
    })
    mergeBlock.log(
        'Median',
        distanceInWordsStrict(now, now + median(allTimes))
    )

    const percentileVals = prs.map(pr => {
        const openTime = new Date(pr.mergedAt) - new Date(pr.createdAt)
        return {...pr, openTime}
    })
    const p90 = percentile(90, percentileVals, item => item.openTime)
    mergeBlock.log(
        'p90',
        distanceInWordsStrict(now, now + p90.openTime),
        `(#${p90.number})`
    )
    mergeBlock.end()
}

main().catch(console.error)
