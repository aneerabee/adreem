export default function ConfigurationErrorPage() {
  return (
    <main className="adreem-login-app" dir="rtl">
      <section className="adreem-login-card" role="alert">
        <div className="adreem-login-brand">
          <span>ADREEM</span>
          <h1>الدفتر غير متصل</h1>
          <p>لم تُفتح نسخة محلية حمايةً لبياناتك. أعد المحاولة بعد عودة الاتصال السحابي.</p>
        </div>
        <button type="button" onClick={() => window.location.reload()}>
          إعادة المحاولة
        </button>
      </section>
    </main>
  )
}
