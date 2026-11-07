// Integração com a Google Pay API (web). O token gerado aqui é enviado ao servidor, que cobra no gateway.
const SCRIPT_URL = 'https://pay.google.com/gp/p/js/pay.js';
const BASE_REQUEST = { apiVersion: 2, apiVersionMinor: 0 };
const CARD_NETWORKS = ['MASTERCARD', 'VISA', 'AMEX'];

let scriptPromise = null, client = null, clientEnvironment = '';

function loadScript() {
  if (window.google?.payments?.api?.PaymentsClient) return Promise.resolve();
  scriptPromise ??= new Promise((resolve, reject) => {
    const script = Object.assign(document.createElement('script'), { src: SCRIPT_URL, async: true });
    script.onload = resolve;
    script.onerror = () => { scriptPromise = null; script.remove(); reject(new Error('Não foi possível carregar o Google Pay.')); };
    document.head.append(script);
  });
  return scriptPromise;
}

const cardMethod = config => ({
  type: 'CARD',
  parameters: { allowedAuthMethods: ['PAN_ONLY', 'CRYPTOGRAM_3DS'], allowedCardNetworks: CARD_NETWORKS },
  tokenizationSpecification: {
    type: 'PAYMENT_GATEWAY',
    parameters: { gateway: config.gateway, 'stripe:version': config.stripeVersion, 'stripe:publishableKey': config.publishableKey }
  }
});

async function paymentsClient(config) {
  await loadScript();
  if (!client || clientEnvironment !== config.environment) {
    client = new window.google.payments.api.PaymentsClient({ environment: config.environment });
    clientEnvironment = config.environment;
  }
  return client;
}

export const GooglePay = {
  // Verdadeiro quando o navegador e a conta do usuário aceitam pagar com Google Pay.
  async isReady(config) {
    if (!config) return false;
    try {
      const payments = await paymentsClient(config);
      const { result } = await payments.isReadyToPay({ ...BASE_REQUEST, allowedPaymentMethods: [{ ...cardMethod(config), tokenizationSpecification: undefined }] });
      return Boolean(result);
    } catch (error) {
      console.warn('[MangaKindle] Google Pay indisponível:', error?.message ?? error);
      return false;
    }
  },

  // Desenha o botão oficial do Google Pay; onToken recebe o token de pagamento (texto JSON).
  async renderButton(container, config, { priceCents, currency, onToken, onError }) {
    const payments = await paymentsClient(config);
    const button = payments.createButton({
      buttonType: 'pay', buttonSizeMode: 'fill', buttonColor: 'default', buttonLocale: 'pt',
      onClick: async () => {
        try {
          const data = await payments.loadPaymentData({
            ...BASE_REQUEST,
            allowedPaymentMethods: [cardMethod(config)],
            merchantInfo: { merchantName: config.merchantName, ...(config.merchantId && { merchantId: config.merchantId }) },
            transactionInfo: {
              totalPriceStatus: 'FINAL', totalPrice: (priceCents / 100).toFixed(2), currencyCode: currency, countryCode: 'BR'
            }
          });
          await onToken(data.paymentMethodData.tokenizationData.token);
        } catch (error) {
          if (error?.statusCode === 'CANCELED') return; // o usuário fechou a janela
          onError?.(error);
        }
      }
    });
    container.replaceChildren(button);
  }
};
