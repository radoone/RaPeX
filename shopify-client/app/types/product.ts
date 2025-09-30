export interface Product {
  id: string;
  title: string;
  description?: string;
  descriptionHtml?: string;
  vendor?: string;
  productType?: string;
  tags?: string[];
  handle: string;
  featuredImage?: {
    url: string;
    altText?: string;
  };
  variants: ProductVariant[];
  createdAt: string;
  updatedAt: string;
}

export interface ProductVariant {
  id: string;
  title: string;
  sku?: string;
  selectedOptions?: Array<{
    name: string;
    value: string;
  }>;
  image?: {
    url: string;
    altText?: string;
  };
  price: {
    amount: string;
    currencyCode: string;
  };
}

export interface SafetyAlert {
  id: string;
  productId: string;
  productTitle: string;
  checkResult: SafetyCheckResult;
  status: 'active' | 'dismissed' | 'resolved';
  createdAt: string;
  updatedAt: string;
  dismissedAt?: string;
  dismissedBy?: string;
  notes?: string;
}

export interface SafetyCheckResult {
  isSafe: boolean;
  warnings: Array<{
    alertId: string;
    similarity: number;
    riskLevel: string;
    reason: string;
    alertDetails: SafetyGateAlertDetails;
  }>;
  recommendation: string;
  checkedAt: string;
}

export interface SafetyGateAlertDetails {
  meta: {
    recordid: string;
    alert_date: string;
    ingested_at: string;
  };
  fields: {
    product_category: string;
    product_description: string;
    risk_level: string;
    notifying_country: string;
    product_brand?: string;
    product_model?: string;
  };
}

export interface DashboardStats {
  totalProducts: number;
  checkedProducts: number;
  unsafeProducts: number;
  pendingChecks: number;
  lastCheckAt?: string;
}

export interface AlertFilters {
  status?: 'active' | 'dismissed' | 'resolved';
  riskLevel?: 'low' | 'medium' | 'high' | 'serious';
  dateFrom?: string;
  dateTo?: string;
  productType?: string;
}
