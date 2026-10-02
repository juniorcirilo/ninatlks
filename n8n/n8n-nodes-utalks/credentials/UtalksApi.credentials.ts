import type {
  IAuthenticateGeneric,
  ICredentialTestRequest,
  ICredentialType,
  INodeProperties,
} from 'n8n-workflow';

export class UtalksApi implements ICredentialType {
  name = 'utalksApi';
  displayName = 'utalks API';
  documentationUrl = 'https://utalks.ubva.com.br';
  icon = 'file:utalks.svg' as const;

  properties: INodeProperties[] = [
    {
      displayName: 'URL do utalks',
      name: 'baseUrl',
      type: 'string',
      default: 'https://utalks.ubva.com.br',
      placeholder: 'https://utalks.ubva.com.br',
      description:
        'Endereço do servidor. Na mesma rede Docker do utalks, http://utalks:3001 evita a volta pelo nginx.',
    },
    {
      displayName: 'Chave do node (N8N_NODE_API_KEY)',
      name: 'apiKey',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      description: 'O valor de N8N_NODE_API_KEY no .env do servidor do utalks',
    },
    {
      displayName: 'ID da conta',
      name: 'accountId',
      type: 'string',
      default: '',
      placeholder: '00000000-0000-0000-0000-000000000000',
      description:
        'Conta usada nas operações. O usuário configurado em N8N_NODE_USER_ID precisa ser membro dela.',
    },
  ];

  authenticate: IAuthenticateGeneric = {
    type: 'generic',
    properties: {
      headers: { Authorization: '=Bearer {{$credentials.apiKey}}' },
    },
  };

  test: ICredentialTestRequest = {
    request: {
      baseURL: '={{$credentials.baseUrl.replace(/\/+$/, "")}}',
      url: '=/accounts/{{$credentials.accountId}}',
      method: 'GET',
    },
  };
}
