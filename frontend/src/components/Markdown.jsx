import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import mermaid from 'mermaid'
import hljs from 'highlight.js'

import 'katex/dist/katex.min.css'
import 'highlight.js/styles/atom-one-dark.css'

// Initialise Mermaid (diagrammes : flowchart, pie, séquence, gantt…)
let mermaidReady = false
try {
  mermaid.initialize({
    startOnLoad: false,
    theme: 'dark',
    themeVariables: {
      background: '#1a1a1a',
      primaryColor: '#2a2a3a',
      primaryTextColor: '#f2f2f2',
      lineColor: '#8f8f8f',
      fontSize: '14px',
    },
    securityLevel: 'loose',
  })
  mermaidReady = true
} catch (_) {
  mermaidReady = false
}

function MermaidBlock({ chart }) {
  const [svg, setSvg] = useState('')

  useEffect(() => {
    if (!mermaidReady) { setSvg(''); return }
    let cancelled = false
    const id = 'mermaid-' + Math.random().toString(36).slice(2, 10)
    mermaid
      .render(id, chart)
      .then((r) => { if (!cancelled) setSvg(r.svg) })
      .catch(() => { if (!cancelled) setSvg('<div class="mermaid-error">Diagramme invalide</div>') })
    return () => { cancelled = true }
  }, [chart])

  if (!svg) return <div className="mermaid-loading">Diagramme…</div>
  return <div className="mermaid" dangerouslySetInnerHTML={{ __html: svg }} />
}

// Bloc de diff : lignes + (ajoutées, vert), - (supprimées, rouge), @@ (en-tête).
function DiffBlock({ code }) {
  const lines = code.split('\n')
  return (
    <pre className="code-block diff">
      {lines.map((line, i) => {
        let cls = 'diff-context'
        if (line.startsWith('+')) cls = 'diff-add'
        else if (line.startsWith('-')) cls = 'diff-del'
        else if (line.startsWith('@@')) cls = 'diff-hunk'
        return <div key={i} className={cls}>{line || ' '}</div>
      })}
    </pre>
  )
}

// Bloc ```chart : graphe simple (camembert / barres / lignes), facile à écrire pour l'IA.
function PieChart({ data }) {
  const total = data.reduce((s, d) => s + d.value, 0)
  const colors = ['#5B7CFF', '#4FA8E0', '#F18B42', '#7ee2a8', '#ffa198', '#79c0ff', '#d2a3f0', '#e3b341', '#ffd166', '#8fd3a8']
  let angle = -Math.PI / 2
  const R = 60, cx = 70, cy = 70
  const slices = []
  for (let i = 0; i < data.length; i++) {
    const frac = data[i].value / total
    const a1 = angle + frac * 2 * Math.PI
    const x0 = cx + R * Math.cos(angle), y0 = cy + R * Math.sin(angle)
    const x1 = cx + R * Math.cos(a1), y1 = cy + R * Math.sin(a1)
    const largeArc = frac > 0.5 ? 1 : 0
    slices.push(<path key={i} d={`M${cx} ${cy} L${x0} ${y0} A${R} ${R} 0 ${largeArc} 1 ${x1} ${y1} Z`} fill={colors[i % colors.length]} />)
    angle = a1
  }
  return (
    <div className="chart-wrap">
      <svg viewBox="0 0 140 140" className="chart-pie">{slices}</svg>
      <div className="chart-legend">
        {data.map((d, i) => (
          <div key={i} className="chart-legend-item">
            <span className="chart-dot" style={{ background: colors[i % colors.length] }} />
            <span>{d.label}</span>
            <span className="chart-val">{d.value} ({total ? Math.round((d.value / total) * 100) : 0}%)</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function BarChart({ data, line }) {
  const max = Math.max(...data.map((d) => d.value), 1)
  const W = 400, H = 180, pad = 30
  const n = data.length
  const bw = (W - pad * 2) / n
  const color = '#5B7CFF'
  const pts = data.map((d, i) => {
    const x = pad + i * bw + bw / 2
    const y = H - pad - (d.value / max) * (H - pad * 2)
    return { x, y, d }
  })
  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="chart-bars">
        {line ? (
          <polyline points={pts.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke={color} strokeWidth="2" />
        ) : (
          pts.map((p, i) => (
            <rect key={i} x={p.x - bw / 2.4} y={p.y} width={bw / 1.2} height={H - pad - p.y} rx={3} fill={color} />
          ))
        )}
        {pts.map((p, i) => (
          <text key={i} x={p.x} y={H - 8} textAnchor="middle" fill="#8f8f8f" fontSize="9">{p.d.label}</text>
        ))}
        {line && pts.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="3" fill={color} />
        ))}
      </svg>
    </div>
  )
}

function ChartBlock({ code }) {
  const lines = code.split('\n').filter((l) => l.trim() !== '')
  let type = 'camembert'
  const data = []
  for (const line of lines) {
    const t = line.trim()
    if (t.startsWith('type:')) { type = t.slice(5).trim().toLowerCase(); continue }
    const m = t.match(/^(.+?)\s+(-?\d+(?:[.,]\d+)?)$/)
    if (m) data.push({ label: m[1].trim(), value: parseFloat(m[2].replace(',', '.')) })
  }
  if (data.length === 0) return null
  if (type.includes('bar')) return <BarChart data={data} />
  if (type.includes('ligne') || type === 'line') return <BarChart data={data} line />
  return <PieChart data={data} />
}

function CodeRenderer({ inline, className, children }) {
  if (inline) {
    return <code className="inline-code">{children}</code>
  }
  const match = /language-(\w+)/.exec(className || '')
  const lang = match ? match[1].toLowerCase() : ''
  const code = String(children).replace(/\n$/, '')

  if (lang === 'mermaid') return <MermaidBlock chart={code} />
  if (lang === 'diff') return <DiffBlock code={code} />
  if (lang === 'chart') return <ChartBlock code={code} />

  let highlighted = code
  if (lang && hljs.getLanguage(lang)) {
    try {
      highlighted = hljs.highlight(code, { language: lang }).value
    } catch (_) {}
  }
  return (
    <pre className="code-block">
      <code className="hljs" dangerouslySetInnerHTML={{ __html: highlighted }} />
    </pre>
  )
}

export default function Markdown({ children }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex, rehypeRaw]}
        components={{
          code: CodeRenderer,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
