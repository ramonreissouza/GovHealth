# scripts/pipeline-logon.ps1 - religa o pipeline do PNCP depois de um reboot.
#
# Chamado pela tarefa agendada "GovHealth Pipeline Noite" (gatilho: logon).
#
# Faz duas coisas, nesta ordem, porque a segunda nao serve sem a primeira:
#   1) keep-awake, se ainda nao estiver rodando. Um pipeline que sobrevive ao
#      reboot mas dorme 20 min depois nao coletou nada. O keep-awake usa
#      SetThreadExecutionState e o efeito morre com o processo, entao ele tem
#      que estar vivo junto.
#   2) pipeline-noite.mjs, que encadeia portais das abertas -> valores ->
#      portais do historico, um dono por vez.
#
# Nao ha lock de instancia no .mjs; quem garante instancia unica e a tarefa
# (MultipleInstances = IgnoreNew). Se voce subir um pipeline a mao E o logon
# disparar, vao existir dois brigando pelo PNCP - pare um.
#
# Acentos: este arquivo tem BOM UTF-8 de proposito. Sem BOM o PS 5.1 le como
# ANSI e qualquer travessao quebra o parser (foi o bug do keep-awake.ps1).
$ErrorActionPreference = 'Continue'
$raiz = 'C:\Users\souza\OneDrive\Documentos\TecHealth\Hospmult\govhealth-ai (1)\govhealth-ai-clean'
$node = 'C:\Program Files\nodejs\node.exe'
Set-Location $raiz

function Registrar($msg) {
  "=== [logon] $msg $(Get-Date -Format 'dd/MM HH:mm') ===" |
    Out-File -FilePath 'pipeline-noite.log' -Append -Encoding utf8
}

# ── 1) keep-awake ───────────────────────────────────────────────────────────
# O filtro exclui $PID: sem isso o Win32_Process casa com o proprio PowerShell
# que esta consultando, porque o texto "keep-awake" esta na linha de comando dele.
$vivo = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
  Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -match 'keep-awake' })

if ($vivo.Count -eq 0) {
  Start-Process powershell.exe `
    -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "$raiz\scripts\keep-awake.ps1" `
    -WorkingDirectory $raiz -WindowStyle Hidden | Out-Null
  Registrar 'keep-awake iniciado'
} else {
  Registrar "keep-awake ja rodando (PID $($vivo[0].ProcessId))"
}

# ── 2) pipeline ─────────────────────────────────────────────────────────────
# Redirecionamento pelo cmd, nao pelo '>>' do PowerShell: o PS 5.1 grava UTF-16
# e corrompe o log.
Registrar 'pipeline-noite iniciando'
& cmd.exe /c "`"$node`" scripts\pipeline-noite.mjs >> pipeline-noite.log 2>&1"
Registrar "pipeline-noite terminou (exit $LASTEXITCODE)"
