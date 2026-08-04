@echo off
rem scripts\radar\connect-service.cmd — sobe o SERVICO DE CONEXAO do Radar.
rem
rem Por que existe: quando o cliente clica "Conectar portal" na tela (em producao),
rem o pedido entra na fila (radar_credenciais.conexao_status='pendente') e ALGUEM
rem precisa abrir a janela real do gov.br para o login. Quem faz isso e o
rem connect-service, que roda NESTA maquina (a Vercel nao abre browser).
rem
rem Fica no Startup do usuario (nao como tarefa agendada: gatilho "ao fazer logon"
rem exige elevacao). Para desligar, remova o .cmd de:
rem   %APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
rem
rem Log: scripts\radar\connect.log
cd /d "%~dp0..\.."
node scripts\radar\connect-service.mjs --poll 15 >> scripts\radar\connect.log 2>&1
