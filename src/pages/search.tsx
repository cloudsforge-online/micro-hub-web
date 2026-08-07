/**
 * Search: four groups, each degrading on its own, each honest about how far it looked.
 *
 * ── This is a composition, not an index, and the results say so ────────────────────────────────
 *
 * hub-api stores nothing. Each group is a bounded page fetched from the service that owns it and
 * filtered in that process, so "the recall is honestly bounded, and the response says so. A user
 * searching for a transaction from last year will not find it, because the page this searched did
 * not reach that far back — so every group carries `truncated`, and the client shows 'showing
 * matches from your recent history' rather than 'no results', which is a different and false
 * claim" (`hub-api/src/search.ts`).
 *
 * Rendering `truncated` is therefore not a nicety. A search that answers "nothing" when it means
 * "nothing in the last hundred records" has told the reader their transaction does not exist.
 *
 * Reads `GET /v1/search?q=` — hub-api/src/server.ts.
 */
import { useCallback } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Empty, Failed, Forbidden, Loading } from '../components/states.tsx'
import { DegradedBanner, TilePanel } from '../components/tile.tsx'
import { search, type SearchGroup, type SearchResponse } from '../lib/hub.ts'
import { useResource } from '../lib/resource.ts'
import { degradedSentence, hasAnswer, type Tile } from '../lib/tile.ts'

const GROUPS: ReadonlyArray<{ key: keyof SearchResponse['groups']; title: string }> = [
  { key: 'wallets', title: 'Wallets' },
  { key: 'transactions', title: 'Transactions' },
  { key: 'tokens', title: 'Tokens' },
  { key: 'activity', title: 'Activity' },
]

export function SearchPage() {
  const [params] = useSearchParams()
  const query = (params.get('q') ?? '').trim()

  const load = useCallback((signal: AbortSignal) => search(signal, query), [query])
  const { state, data, error, reload } = useResource(
    load,
    (response) => response.total,
    'That search did not complete.',
  )

  if (query.length === 0) {
    return (
      <Empty
        title="Tell us what to look for"
        hint="Try a wallet address, a transaction hash, the name of an asset, or anything you remember from your recent activity."
      />
    )
  }
  if (state === 'forbidden') return <Forbidden notice={error ?? undefined} />
  if (state === 'failed' && error) return <Failed notice={error} onRetry={reload} />
  if (state === 'loading' || !data) return <Loading label={`Searching for ${query}`} />

  const anyTruncated = GROUPS.some((group) => {
    const tile = data.groups[group.key]
    return hasAnswer(tile) && tile.data.truncated
  })

  return (
    <>
      <header className="wt-page__head">
        <h1 className="wt-page__title">
          Results for <span className="cf-num">{data.query}</span>
        </h1>
        <p className="wt-page__meta cf-num">
          {data.total} {data.total === 1 ? 'match' : 'matches'}
        </p>
      </header>

      <DegradedBanner sentence={degradedSentence(data.degraded)} />

      {/*
        The bounded-window caveat, stated once and at the top. A reader who has just been told
        "no results" needs to know the window before they conclude the thing does not exist.
      */}
      {anyTruncated && (
        <p className="wt-banner" role="status">
          What you can see comes out of your recent history. Each service is asked for one page
          rather than searched through an index, so something older may well match and simply was
          not among the records we looked at.
        </p>
      )}

      {data.total === 0 && !anyTruncated && (
        <Empty
          title={`Nothing matched ${data.query}`}
          hint="Every source answered us, and not one of them had anything resembling this."
        />
      )}

      {GROUPS.map((group) => (
        <GroupPanel key={group.key} title={group.title} tile={data.groups[group.key]} />
      ))}
    </>
  )
}

function GroupPanel({ title, tile }: { title: string; tile: Tile<SearchGroup> }) {
  // A group that answered with nothing gets no panel at all: four empty panels under a search is
  // four ways of saying the same thing. A group that FAILED does get one, because "we did not
  // look here" is information the reader needs in order to trust the rest.
  if (hasAnswer(tile) && tile.data.results.length === 0) return null

  return (
    <TilePanel title={title} tile={tile} empty={null}>
      {tile.data.results.length === 0 ? null : (
        <ul className="wt-rows">
          {tile.data.results.map((result) => (
            <li className="wt-row" key={`${result.kind}:${result.id}`}>
              <span className="wt-row__main">
                {/* hub-api emits relative deep links; the SPA owns its own origin. */}
                <Link className="wt-row__title wt-link" to={result.href}>
                  {result.title}
                </Link>
                <span className="wt-row__sub cf-num">{result.subtitle}</span>
              </span>
              <span className="wt-row__meta">
                <span className="wt-chip">{result.source}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {tile.data.truncated && (
        <p className="wt-note wt-note--caveat">
          The window searched was full, so an older match could exist and was not seen.
        </p>
      )}
    </TilePanel>
  )
}
