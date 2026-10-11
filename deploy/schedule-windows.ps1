# Agenda a virada de mês/ano da Be Fluent no Agendador de Tarefas do Windows.
# Rode uma vez (clique direito > "Executar com o PowerShell", ou no terminal).
#
# Cria a tarefa "BeFluent-Virada" para rodar todo dia às 08:00 chamando
# `npm run rollover`. Idempotente: rodar de novo só atualiza a tarefa.

$ErrorActionPreference = "Stop"

# Pasta frontend = pai deste script (deploy) + ..\frontend
$deployDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$frontend = Resolve-Path (Join-Path $deployDir "..\frontend")
$logFile = Join-Path (Resolve-Path (Join-Path $deployDir "..")) "rollover.log"

$command = "cd /d `"$frontend`" && npm run rollover >> `"$logFile`" 2>&1"

Write-Host "Criando tarefa 'BeFluent-Virada' (diária, 08:00)..."
Write-Host "  Pasta: $frontend"
Write-Host "  Log:   $logFile"

schtasks /Create /TN "BeFluent-Virada" /SC DAILY /ST 08:00 /F /TR "cmd /c $command" | Out-Null

Write-Host ""
Write-Host "Pronto. Conferir:  schtasks /Query /TN BeFluent-Virada"
Write-Host "Rodar agora:       schtasks /Run /TN BeFluent-Virada"
Write-Host "Remover:           schtasks /Delete /TN BeFluent-Virada /F"
