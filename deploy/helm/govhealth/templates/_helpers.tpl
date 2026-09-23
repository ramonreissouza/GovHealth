{{/* Segura o pod até o Postgres aceitar conexão, no lugar do
     `depends_on: condition: service_healthy` do compose. `-h db` pela porta
     TCP: sem o host, o pg_isready responde "pronto" ainda no servidor
     temporário do initdb, que só escuta no socket unix. */}}
{{- define "govhealth.waitForDb" -}}
- name: wait-for-db
  image: {{ .Values.db.image }}
  command:
    - sh
    - -c
    - 'until pg_isready -h db -U govhealth -d govhealth; do echo "aguardando o banco..."; sleep 2; done'
  resources:
    requests: { cpu: 10m, memory: 32Mi }
    limits: { cpu: 200m, memory: 64Mi }
{{- end -}}
