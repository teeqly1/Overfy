import React, { Component } from 'react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, errorInfo) {
    console.error('App error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="screen error-screen">
          <div className="error-code">Ошибка</div>
          <p>Что-то пошло не так. Перезагрузите страницу.</p>
          <button className="btn" onClick={() => window.location.reload()}>
            Перезагрузить
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
