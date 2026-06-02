import { useCallback, useEffect, useMemo, useState } from 'react';
import AppAlert from '../ui/AppAlert';
import AppButton from '../ui/AppButton';
import AppDataPanel from '../ui/AppDataPanel';
import AppDropdownMenu from '../ui/AppDropdownMenu';
import InlineLoader from '../ui/InlineLoader';
import LoadingButton from '../ui/LoadingButton';
import ConfirmActionModal from '../ConfirmActionModal';
import {
  cancelCurrentSubscription,
  createSubscriptionCheckoutSession,
  getSubscriptionOverview,
  getSubscriptionPlanName,
  listSubscriptionPlans,
  type SubscriptionOverview,
  type SubscriptionPlan,
  type SubscriptionPlanType,
} from '../../api/subscriptions';

interface SubscriptionSectionProps {
  enabled: boolean;
}

type CancelMode = 'period_end' | 'immediate' | null;

function formatDateTime(value: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function renderSubscriptionStatus(overview: SubscriptionOverview | null): string {
  if (!overview?.activeSubscription) return '未契約';
  if (overview.activeSubscription.cancelAtPeriodEnd) return '期間終了で解約予定';
  return '利用中';
}

export default function SubscriptionSection({ enabled }: SubscriptionSectionProps) {
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [overview, setOverview] = useState<SubscriptionOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stripeConfigured, setStripeConfigured] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [checkoutPlan, setCheckoutPlan] = useState<SubscriptionPlanType | null>(null);
  const [cancelMode, setCancelMode] = useState<CancelMode>(null);
  const [cancelPending, setCancelPending] = useState(false);

  const loadSubscriptionState = useCallback(async (signal?: AbortSignal) => {
    const [plansResponse, overviewResponse] = await Promise.all([
      listSubscriptionPlans(signal),
      getSubscriptionOverview(signal),
    ]);
    setPlans(plansResponse.plans);
    setStripeConfigured(plansResponse.stripeConfigured);
    setOverview(overviewResponse);
  }, []);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError('');
    void loadSubscriptionState(controller.signal)
      .catch((err) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'サブスクリプション情報の取得に失敗しました');
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [enabled, loadSubscriptionState]);

  const activeSubscription = overview?.activeSubscription ?? null;
  const subscriptionHistory = useMemo(
    () => overview?.subscriptions.filter((subscription) => subscription.id !== activeSubscription?.id) ?? [],
    [activeSubscription?.id, overview?.subscriptions],
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError('');
    try {
      await loadSubscriptionState();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'サブスクリプション情報の取得に失敗しました');
    } finally {
      setRefreshing(false);
    }
  }, [loadSubscriptionState]);

  const handleCheckout = useCallback(async (plan: SubscriptionPlanType) => {
    setCheckoutPlan(plan);
    setError('');
    setNotice('');
    try {
      const origin = window.location.origin;
      const successUrl = `${origin}/subscription/success?session_id={CHECKOUT_SESSION_ID}`;
      const cancelUrl = `${origin}/subscription/cancel`;
      const result = await createSubscriptionCheckoutSession(plan, successUrl, cancelUrl);
      window.location.assign(result.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'チェックアウトの開始に失敗しました');
    } finally {
      setCheckoutPlan(null);
    }
  }, []);

  const handleConfirmCancel = useCallback(async () => {
    if (!cancelMode) return;
    setCancelPending(true);
    setError('');
    setNotice('');
    try {
      const result = await cancelCurrentSubscription(cancelMode === 'immediate');
      setNotice(result.message);
      await loadSubscriptionState();
      setCancelMode(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'サブスクリプションの解約に失敗しました');
    } finally {
      setCancelPending(false);
    }
  }, [cancelMode, loadSubscriptionState]);

  if (!enabled) {
    return null;
  }

  return (
    <>
      <AppDataPanel
        title="サブスクリプション / 請求"
        actions={(
          <LoadingButton
            variant="outline-secondary"
            size="sm"
            onClick={refresh}
            loading={refreshing}
            loadingLabel="更新中..."
            disabled={loading}
          >
            更新
          </LoadingButton>
        )}
        className="mb-3"
      >
        {loading ? (
          <InlineLoader text="サブスクリプション情報を読み込み中..." className="text-muted small" />
        ) : (
          <div className="d-flex flex-column gap-3">
            {notice && (
              <AppAlert variant="success" onClose={() => setNotice('')} dismissible>
                {notice}
              </AppAlert>
            )}
            {error && (
              <AppAlert variant="danger" onClose={() => setError('')} dismissible>
                {error}
              </AppAlert>
            )}
            {!stripeConfigured && (
              <AppAlert variant="warning">
                決済設定がまだ有効化されていません。プラン表示はできますが、申込は開始できません。
              </AppAlert>
            )}

            <div className="d-flex flex-column gap-1 small">
              <div className="text-muted">契約ステータス</div>
              <div className="fw-semibold">{renderSubscriptionStatus(overview)}</div>
              <div className="text-muted">
                {activeSubscription
                  ? `現在のプラン: ${getSubscriptionPlanName(activeSubscription.planType)}`
                  : '有効な契約はありません'}
              </div>
              {activeSubscription?.currentPeriodEnd && (
                <div className="text-muted">
                  次回更新日: {formatDateTime(activeSubscription.currentPeriodEnd)}
                </div>
              )}
              {activeSubscription?.cancelAtPeriodEnd && (
                <div className="text-warning">
                  期間終了後に解約されます。必要なら満了前に再度プランを契約してください。
                </div>
              )}
            </div>

            {activeSubscription ? (
              <div className="dl-action-row mobile-stack">
                {!activeSubscription.cancelAtPeriodEnd && (
                  <AppButton variant="outline-warning" onClick={() => setCancelMode('period_end')}>
                    期間終了で解約する
                  </AppButton>
                )}
                <AppDropdownMenu
                  label="解約操作"
                  variant="outline-secondary"
                  items={[
                    {
                      label: '即時解約する',
                      onClick: () => setCancelMode('immediate'),
                      danger: true,
                    },
                  ]}
                />
              </div>
            ) : (
              <div className="d-flex flex-column gap-3">
                {plans.map((plan) => (
                  <div key={plan.id} className="border rounded p-3">
                    <div className="dl-action-row mobile-stack justify-content-between align-items-start">
                      <div>
                        <div className="fw-semibold">{plan.name}</div>
                        <div className="text-muted small">月額 {plan.priceFormatted}</div>
                      </div>
                      <LoadingButton
                        variant={plan.id === 'standard' ? 'primary' : 'outline-primary'}
                        onClick={() => void handleCheckout(plan.id)}
                        loading={checkoutPlan === plan.id}
                        loadingLabel="移動中..."
                        disabled={!stripeConfigured}
                      >
                        このプランで申し込む
                      </LoadingButton>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {subscriptionHistory.length > 0 && (
              <div className="small">
                <div className="fw-semibold mb-2">契約履歴</div>
                <div className="d-flex flex-column gap-2">
                  {subscriptionHistory.slice(0, 3).map((subscription) => (
                    <div key={subscription.id} className="border rounded p-2">
                      <div>{getSubscriptionPlanName(subscription.planType)}</div>
                      <div className="text-muted">
                        状態: {subscription.status} / 開始: {formatDateTime(subscription.createdAt)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </AppDataPanel>

      <ConfirmActionModal
        show={cancelMode !== null}
        title={cancelMode === 'immediate' ? '即時解約の確認' : '期間終了で解約'}
        body={cancelMode === 'immediate'
          ? '今すぐ契約を解約します。残り期間の利用にも影響する可能性があります。実行してよろしいですか？'
          : '現在の契約期間が終了した時点で自動解約します。実行してよろしいですか？'}
        confirmLabel={cancelMode === 'immediate' ? '即時解約する' : '解約予約する'}
        confirmVariant={cancelMode === 'immediate' ? 'danger' : 'warning'}
        onCancel={() => setCancelMode(null)}
        onConfirm={() => void handleConfirmCancel()}
        pending={cancelPending}
      />
    </>
  );
}
