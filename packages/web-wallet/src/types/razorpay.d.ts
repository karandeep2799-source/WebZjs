export {};

declare global {
  interface RazorpayPaymentSuccessResponse {
    razorpay_payment_id: string;
    razorpay_order_id: string;
    razorpay_signature: string;
  }

  interface RazorpayOptions {
    key: string;
    amount: number;
    currency: string;
    name: string;
    description?: string;
    order_id: string;
    handler: (response: RazorpayPaymentSuccessResponse) => void | Promise<void>;
    prefill?: {
      name?: string;
      email?: string;
      contact?: string;
    };
    theme?: { color?: string };
    modal?: { ondismiss?: () => void };
  }

  interface RazorpayInstance {
    open(): void;
    close(): void;
  }

  interface Window {
    Razorpay?: new (options: RazorpayOptions) => RazorpayInstance;
  }
}
