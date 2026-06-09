import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

class AppErrorBoundary extends React.Component<React.PropsWithChildren, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("Flow Shuttle renderer failed to render", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <main className="app-error-screen">
          <section>
            <h1>页面加载出错</h1>
            <p>当前页面渲染时遇到问题。请先返回上一页或重启流梭，未保存的数据不会被主动删除。</p>
            <pre>{this.state.error.message}</pre>
          </section>
        </main>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>
);
