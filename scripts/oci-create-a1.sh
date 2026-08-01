#!/usr/bin/env bash
# oci-create-a1.sh — cria a VM Ampere A1 (Always Free) tentando em loop até haver capacidade.
#
# RODAR NO ORACLE CLOUD SHELL (ícone >_ no topo do console). Lá o OCI CLI já está
# instalado e autenticado com sua sessão — não precisa de chave de API.
#
# Descobre sozinho: Availability Domain, VCN, subnet pública e imagem Ubuntu 24.04 ARM.
# Fica tentando `instance launch` a cada $SLEEP segundos; para quando conseguir criar.
#
# Para deixar rodando a noite toda mesmo se o navegador cair, rode dentro do tmux:
#   tmux new -s a1        # abre a sessão
#   bash oci-create-a1.sh # (ou cole o conteúdo)
#   # destacar: Ctrl+B depois D    |    reanexar: tmux attach -t a1

set -uo pipefail

# ===== CONFIG =====
OCPUS=1                 # 1 OCPU passa com mais frequência; pode subir p/ 2, 3 ou 4
MEM_GB=6                # 6 GB (regra Ampere: 6 GB por OCPU no free)
DISPLAY_NAME="govhealth-db"
BOOT_GB=50              # 50 GB (dentro do Always Free de 200 GB)
VCN_NAME="vcn-govhealth"
SLEEP=45                # segundos entre tentativas
SSH_PUB='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJo30ybJoJnN95Ta0ulR0T+euCaIaQxUTuSkcrO76zMW govhealth-oracle-vm'
# ==================

C="${OCI_TENANCY:?OCI_TENANCY não definido — rode isto no Cloud Shell}"

echo "== Descobrindo recursos na sua tenancy =="

AD=$(oci iam availability-domain list --query 'data[0].name' --raw-output)
echo "Availability Domain: $AD"

VCN_ID=$(oci network vcn list -c "$C" --display-name "$VCN_NAME" --query 'data[0].id' --raw-output 2>/dev/null || true)
if [ -z "${VCN_ID:-}" ] || [ "$VCN_ID" = "None" ]; then
  echo "(VCN '$VCN_NAME' não encontrada pelo nome; usando a primeira VCN da conta)"
  VCN_ID=$(oci network vcn list -c "$C" --query 'data[0].id' --raw-output)
fi
echo "VCN: $VCN_ID"

# subnet pública (nome geralmente contém 'public'); senão, a primeira
SUBNET_ID=$(oci network subnet list -c "$C" --vcn-id "$VCN_ID" \
  --query "data[?contains(\"display-name\", 'public')].id | [0]" --raw-output 2>/dev/null || true)
if [ -z "${SUBNET_ID:-}" ] || [ "$SUBNET_ID" = "None" ]; then
  SUBNET_ID=$(oci network subnet list -c "$C" --vcn-id "$VCN_ID" --query 'data[0].id' --raw-output)
fi
echo "Subnet: $SUBNET_ID"

IMAGE_ID=$(oci compute image list -c "$C" \
  --operating-system "Canonical Ubuntu" --operating-system-version "24.04" \
  --shape "VM.Standard.A1.Flex" --sort-by TIMECREATED --sort-order DESC \
  --query 'data[0].id' --raw-output)
echo "Imagem Ubuntu 24.04 ARM: $IMAGE_ID"

echo "$SSH_PUB" > /tmp/ssh_pub.key

echo
echo "== Tentando criar a VM (${OCPUS} OCPU / ${MEM_GB} GB) a cada ${SLEEP}s até conseguir capacidade =="
echo "   (Ctrl+C para parar)"
n=0
while true; do
  n=$((n+1))
  printf '[%s] tentativa %d... ' "$(date +%H:%M:%S)" "$n"
  if oci compute instance launch \
      -c "$C" \
      --availability-domain "$AD" \
      --display-name "$DISPLAY_NAME" \
      --shape "VM.Standard.A1.Flex" \
      --shape-config "{\"ocpus\":$OCPUS,\"memoryInGBs\":$MEM_GB}" \
      --image-id "$IMAGE_ID" \
      --subnet-id "$SUBNET_ID" \
      --assign-public-ip true \
      --boot-volume-size-in-gbs "$BOOT_GB" \
      --ssh-authorized-keys-file /tmp/ssh_pub.key \
      --wait-for-state RUNNING >/tmp/oci_out.log 2>/tmp/oci_err.log; then
    echo "✅ VM CRIADA E RUNNING!"
    IP=$(oci compute instance list-vnics --instance-id \
         "$(oci compute instance list -c "$C" --display-name "$DISPLAY_NAME" --lifecycle-state RUNNING --query 'data[0].id' --raw-output)" \
         --query 'data[0]."public-ip"' --raw-output 2>/dev/null || true)
    echo "IP público: ${IP:-veja no console}"
    break
  fi
  if grep -qi "capacity" /tmp/oci_err.log; then
    echo "sem capacidade; aguardando ${SLEEP}s"
  else
    echo "⚠️ erro diferente:"; cat /tmp/oci_err.log; echo "-- parando --"; break
  fi
  sleep "$SLEEP"
done
