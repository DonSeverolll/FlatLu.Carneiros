import BookingWidget from './BookingWidget';

const amenities = ['1 quarto', '2 banheiros', 'Piscina', 'Garagem', 'Wi-Fi'];

export default function HomePage() {
  return (
    <main>
      <nav className="nav"><strong>CARNEIROS / FLAT</strong><span className="nav-links"><a href="#reserva">Consultar datas</a><a href="/login">Entrar</a></span></nav>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Praia de Carneiros, Pernambuco</p>
          <h1>Seu intervalo entre o mar e o tempo.</h1>
          <p className="lead">Um flat de alto padrão para viver dias leves, com piscina, conforto e a praia a poucos passos.</p>
          <a className="button" href="#reserva">Ver disponibilidade</a>
        </div>
        <div className="hero-image" role="img" aria-label="Área de lazer do flat com piscina" />
      </section>
      <section className="details" id="reserva">
        <div><p className="eyebrow">A casa</p><h2>Conforto pensado para chegar e ficar.</h2></div>
        <div><p>Calendário de disponibilidade, reserva segura e confirmação transparente em um só lugar.</p><div className="amenities">{amenities.map((item) => <span key={item}>{item}</span>)}</div><button className="button" type="button">Consultar calendário</button></div>
      </section>
      <section className="booking-section"><BookingWidget /></section>
    </main>
  );
}
