# opencode-token-tracker

[![CI](https://github.com/eserete/opencode-token-tracker/actions/workflows/ci.yml/badge.svg)](https://github.com/eserete/opencode-token-tracker/actions/workflows/ci.yml)

Real-time token usage, cost, and request tracking for every AI request in [OpenCode](https://opencode.ai).

---

## 🆕 Versão TUI (RECOMENDADA) - `token-tracker.tsx`

Mostra tokens **diretamente no rodapé da sidebar** do OpenCode, em tempo real durante a execução do agente — **sem popups ou toasts**.

```
⏳ last:  in: 70.0k · out: 1.2k · 1 req · $0.04
📊 total: in: 1.2m  · out: 0.3m · 42 reqs · $1.23
```

Após o agente terminar:

```
✓  last:  in: 70.0k · out: 1.2k · 1 req · $0.04
📊 total: in: 1.2m  · out: 0.3m · 42 reqs · $1.23
```

**Linhas:**
- `⏳`/`✓` **last** — tokens e custo do **último request** (útil para ver o custo de cada interação)
- `📊` **total** — acumulado de **toda a sessão** (tokens in, out, número de requests e custo total)

**Atualização:** a cada 2 segundos durante execução.

### Instalação

**1. Copie o plugin:**

```bash
curl -sL https://github.com/eserete/opencode-token-tracker/raw/main/token-tracker.tsx \
  -o ~/.config/opencode/plugins/token-tracker.tsx
```

**2. Registre no `tui.json`** (`~/.config/opencode/tui.json`):

```json
{
  "$schema": "https://opencode.ai/config/tui.json",
  "plugin": ["./plugins/token-tracker.tsx"]
}
```

**3. Reinicie o OpenCode** e abra a sidebar com `Ctrl+X B`.

### Requisitos

- OpenCode v1.4.3+
- Sidebar aberta (`Ctrl+X B`) para o footer aparecer

---

## Versão Real-time Toast - `token-tracker-realtime.js`

Mostra tokens em tempo real em um toast durante a execução do agente:

```
⏳ 1.2k tokens · 12 reqs · $0.05
```

**Instalação:**

```bash
curl -sL https://github.com/eserete/opencode-token-tracker/raw/main/token-tracker-realtime.js \
  -o ~/.config/opencode/plugins/token-tracker-realtime.js
```

---

## Versão Clássica (Toast) - `token-tracker.js`

Mostra um toast **após** cada request completar:

```
[tokens] in: 45,231  |  out: 1,204  |  cache↓: 120,000  |  t: 4.2s  |  $0.0032  |  reqs: 3
```

**Instalação:**

```bash
curl -sL https://github.com/eserete/opencode-token-tracker/raw/main/token-tracker.js \
  -o ~/.config/opencode/plugins/token-tracker.js
```

---

## Qual versão usar?

| Feature | TUI Slot (tsx) | Real-time Toast | Clássica |
|---------|---------------|----------------|----------|
| **Interface** | Sidebar footer | Toast/popup | Toast/popup |
| **Quando mostra** | Sempre visível | Durante execução | Após completar |
| **Last vs Total** | ✅ Ambos | ❌ Apenas total | ✅ Por request |
| **Compatibilidade** | OpenCode v1.4.3+ | Todas as versões | Todas as versões |
| **Update** | A cada 2s | A cada 2s | Uma vez |

**Recomendação:** Use **`token-tracker.tsx`** (TUI) — é a mais completa e não atrapalha o fluxo de trabalho.

---

## Configuração

Nenhuma configuração adicional necessária além da instalação descrita acima.

**Importante:** Após instalar ou atualizar, **reinicie o OpenCode** para o plugin ser recarregado.

---

## Referência de Campos (Versão Clássica)

| Campo | Descrição |
|---|---|
| `in` | Tokens de entrada |
| `out` | Tokens de saída |
| `think` | Tokens de raciocínio |
| `cache↓` | Tokens de cache lidos |
| `cache↑` | Tokens de cache escritos |
| `t` | Latência em segundos |
| `$` | Custo da mensagem |
| `session` | Custo acumulado da sessão |
| model | Provedor/modelo |
| `reqs` | Número de requests |
| `finish` | Razão de término |
| `[+N subagents]` | Subagentes agregados |

---

## Vantagens

- ✅ **Zero configuração** - copie e funcione
- ✅ **Sem popups** - exibição integrada na UI do OpenCode
- ✅ **Last vs Total** - veja o custo de cada interação separado do acumulado
- ✅ **Consciente de subagentes** - agrega tokens automaticamente
- ✅ **Não intrusivo** - erros são silenciosos
- ✅ **Tempo real** - acompanhe o uso enquanto o agente trabalha

---

## Limitações

- Precisão do custo depende do provedor reportar corretamente
- Sem persistência entre sessões
- Versão TUI requer sidebar aberta para o footer aparecer
- Atualiza a cada 2 segundos (não instantâneo)

---

## Licença

MIT
