import React from 'react';

function App() {
  return (
    <div style={{ 
      display: 'flex', 
      justifyContent: 'center', 
      alignItems: 'center', 
      height: '100vh', 
      fontFamily: 'sans-serif',
      backgroundColor: '#f0f0f0'
    }}>
      <div style={{ textAlign: 'center', padding: '2rem', border: '1px solid #ccc', borderRadius: '8px', backgroundColor: 'white' }}>
        <h1>Teste de Compilação</h1>
        <p>Se você está vendo esta mensagem, o seu ambiente está funcionando corretamente.</p>
        <p style={{ color: 'green', fontWeight: 'bold' }}>Pode passar para o próximo passo.</p>
      </div>
    </div>
  );
}

export default App;
