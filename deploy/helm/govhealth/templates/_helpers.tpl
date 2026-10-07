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

{{/* Env do OpenTelemetry (TS-540). Recebe o nome do serviço no SigNoz. A versão é
     o SHA da imagem, para separar o antes e o depois de cada deploy. */}}
{{- define "govhealth.otelEnv" -}}
{{- $ctx := index . 0 -}}
{{- if $ctx.Values.otel.endpoint -}}
- { name: OTEL_EXPORTER_OTLP_ENDPOINT, value: {{ $ctx.Values.otel.endpoint | quote }} }
- { name: OTEL_SERVICE_NAME, value: {{ index . 1 | quote }} }
- { name: OTEL_RESOURCE_ATTRIBUTES, value: {{ printf "service.version=%s,deployment.environment=%s" $ctx.Values.image.tag $ctx.Values.otel.ambiente | quote }} }
{{- end -}}
{{- end -}}
