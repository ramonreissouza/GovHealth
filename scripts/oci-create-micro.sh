#!/usr/bin/env bash
# oci-create-micro.sh — cria a VM AMD Always Free (VM.Standard.E2.1.Micro), que
# NUNCA dá "out of capacity". Alternativa ao A1 quando não há capacidade ARM.
#
# RODAR NO ORACLE CLOUD SHELL (OCI CLI já autenticado). 1 OCPU / 1 GB RAM, x86.
# Depois, na Fase B do runbook, adicionamos 2 GB de swap p/ compensar a RAM.
#
# Diferenças p/ o A1: shape fixo (sem --shape-config) e imagem x86 (não ARM).

set -uo pipefail

# ===== CONFIG =====
DISPLAY_NAME="govhealth-db"
BOOT_GB=50
VCN_NAME="vcn-govhealth"
SSH_PUB='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJo30ybJoJnN95Ta0ulR0T+euCaIaQxUTuSkcrO76zMW govhealth-oracle-vm'
SHAPE="VM.Standard.E2.1.Micro"
# ==================

C="${OCI_TENANCY:?OCI_TENANCY não definido — rode isto no Cloud Shell}"

echo "== Descobrindo recursos =="
AD=$(oci iam availability-domain list --query 'data[0].name' --raw-output)
echo "AD: $AD"

VCN_ID=$(oci network vcn list -c "$C" --display-name "$VCN_NAME" --query 'data[0].id' --raw-output 2>/dev/null || true)
if [ -z "${VCN_ID:-}" ] || [ "$VCN_ID" = "None" ]; then
  VCN_ID=$(oci network vcn list -c "$C" --query 'data[0].id' --raw-output)
fi
echo "VCN: $VCN_ID"

SUBNET_ID=$(oci network subnet list -c "$C" --vcn-id "$VCN_ID" \
  --query "data[?contains(\"display-name\", 'public')].id | [0]" --raw-output 2>/dev/null || true)
if [ -z "${SUBNET_ID:-}" ] || [ "$SUBNET_ID" = "None" ]; then
  SUBNET_ID=$(oci network subnet list -c "$C" --vcn-id "$VCN_ID" --query 'data[0].id' --raw-output)
fi
echo "Subnet: $SUBNET_ID"

# IMPORTANTE: imagem x86_64 (a shape E2 é AMD, não ARM)
IMAGE_ID=$(oci compute image list -c "$C" \
  --operating-system "Canonical Ubuntu" --operating-system-version "24.04" \
  --shape "$SHAPE" --sort-by TIMECREATED --sort-order DESC \
  --query 'data[0].id' --raw-output)
echo "Imagem Ubuntu 24.04 x86: $IMAGE_ID"

echo "$SSH_PUB" > /tmp/ssh_pub.key

echo
echo "== Criando a VM ($SHAPE, 1 OCPU / 1 GB) =="
oci compute instance launch \
  -c "$C" \
  --availability-domain "$AD" \
  --display-name "$DISPLAY_NAME" \
  --shape "$SHAPE" \
  --image-id "$IMAGE_ID" \
  --subnet-id "$SUBNET_ID" \
  --assign-public-ip true \
  --boot-volume-size-in-gbs "$BOOT_GB" \
  --ssh-authorized-keys-file /tmp/ssh_pub.key \
  --wait-for-state RUNNING

INST_ID=$(oci compute instance list -c "$C" --display-name "$DISPLAY_NAME" --lifecycle-state RUNNING --query 'data[0].id' --raw-output)
IP=$(oci compute instance list-vnics --instance-id "$INST_ID" --query 'data[0]."public-ip"' --raw-output)
echo
echo "✅ VM CRIADA E RUNNING!"
echo "IP público: $IP"
echo "Teste: ssh ubuntu@$IP"
