# scripts/keep-awake.ps1 — impede a máquina de suspender por ociosidade enquanto roda.
# Usa SetThreadExecutionState (ES_CONTINUOUS | ES_SYSTEM_REQUIRED): diz ao Windows
# "o sistema está em uso, não durma", em AC OU bateria, SEM alterar o plano de energia.
# O efeito some sozinho quando este processo termina. Reaplica a cada 60s por segurança.
# Uso: powershell -ExecutionPolicy Bypass -File scripts/keep-awake.ps1
$sig = @'
[DllImport("kernel32.dll", SetLastError = true)]
public static extern uint SetThreadExecutionState(uint esFlags);
'@
$p = Add-Type -MemberDefinition $sig -Name Power -Namespace Win32 -PassThru
$ES_CONTINUOUS       = [uint32]"0x80000000"
$ES_SYSTEM_REQUIRED  = [uint32]"0x00000001"
$flags = $ES_CONTINUOUS -bor $ES_SYSTEM_REQUIRED
Write-Output ("[keep-awake] ativo desde {0} — mantendo a máquina acordada (Ctrl+C ou parar o processo desfaz)." -f (Get-Date))
while ($true) {
  [void]$p::SetThreadExecutionState($flags)
  Start-Sleep -Seconds 60
}
