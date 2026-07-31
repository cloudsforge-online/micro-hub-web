/**
 * The two parts of the browser reporter that are pure. The listeners themselves need a browser
 * and are listed as untested in the README.
 */
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { __resetObs, enqueueBounded, envelope } from '../src/lib/obs.ts'
import { installWindow, removeWindow } from './browser-stubs.ts'

afterEach(() => {
  __resetObs()
  removeWindow()
})

const event = (n: number) => envelope({ app: 'trade', type: 'T', message: `m${n}` })

describe('the queue bound', () => {
  it('keeps the newest events when a page is throwing in a loop', () => {
    installWindow('https://trade.cloudsforge.online/')
    let queue = [] as ReturnType<typeof envelope>[]
    for (let i = 0; i < 40; i += 1) queue = enqueueBounded(queue, event(i))
    // A loop's thousandth exception is identical to its first; the state just before the tab was
    // closed is not, so the queue drops from the front.
    assert.equal(queue.length, 32)
    assert.equal(queue[0]?.message, 'm8')
    assert.equal(queue[31]?.message, 'm39')
  })
})

describe('the envelope', () => {
  it('stamps the page the event came from', () => {
    installWindow('https://trade.cloudsforge.online/reports?tab=1')
    const wrapped = event(1)
    assert.equal(wrapped.url, 'https://trade.cloudsforge.online/reports?tab=1')
    assert.equal(wrapped.release, 'unknown', 'no document, so the release is honestly unknown')
    assert.ok(!Number.isNaN(Date.parse(wrapped.at)))
  })
})
