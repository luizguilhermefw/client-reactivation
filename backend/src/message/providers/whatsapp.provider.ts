import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { SendMessageDto } from '../dto/send-message.dto';

@Injectable()
export class WhatsappProvider {
  async send(data: SendMessageDto) {
    const url = `${process.env.ZAPI_URL}/instances/${process.env.ZAPI_INSTANCE_ID}/token/${process.env.ZAPI_INSTANCE_TOKEN}/send-text`;

    try {
      const response = await axios.post(
        url,
        {
          phone: this.formatPhone(data.to),
          message: data.content,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Client-Token': process.env.ZAPI_CLIENT_TOKEN,
          },
        },
      );

      console.log('✅ Mensagem enviada via Z-API');
      console.log('📦 Response:', response.data);

      return response.data;
    } catch (error: any) {
      console.error(
        '❌ Erro Z-API:',
        error?.response?.data || error.message,
      );
      throw error;
    }
  }

  /**
   * Formata telefone para padrão internacional (E.164)
   * - Remove tudo que não for número
   * - Se já tiver código de país (>=12 dígitos), mantém
   * - Caso contrário, assume Brasil (55)
   */
  private formatPhone(phone: string): string {
    const cleaned = phone.replace(/\D/g, '');

    // já está no padrão internacional
    if (cleaned.length >= 12) {
      return cleaned;
    }

    // fallback Brasil
    return `55${cleaned}`;
  }
}