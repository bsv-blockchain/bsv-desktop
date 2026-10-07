import Greeter from '../Greeter'

export default function Recovery({ history }: { history: any }) {
  return <Greeter history={history} initialMode="import" />
}
