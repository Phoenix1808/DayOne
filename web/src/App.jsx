import Join from './Join'
import Board from './Board'

export default function App() {
  const params = new URLSearchParams(window.location.search)
  const j = params.get('j')
  const code = params.get('c') || ''

  if (j !== null && j !== '') {
    return <Join registryId={BigInt(j)} code={code} />
  }
  return <Board />
}
