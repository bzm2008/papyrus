import { AppShell } from './components/AppShell'
import { MascotWindow } from './components/MascotWindow'

function App() {
  if (new URLSearchParams(window.location.search).get('window') === 'mascot') {
    return <MascotWindow />
  }
  return <AppShell />
}

export default App
