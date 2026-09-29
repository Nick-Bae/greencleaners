const body = document.body;
const header = document.querySelector("[data-header]");
const navToggle = document.querySelector("[data-nav-toggle]");
const nav = document.querySelector("[data-nav]");
const contactForm = document.querySelector("[data-contact-form]");
const formNote = document.querySelector("[data-form-note]");
const hero = document.querySelector(".hero");
const heroSlider = document.querySelector("[data-hero-slider]");
const heroSlides = document.querySelectorAll("[data-hero-slide]");
const heroDots = document.querySelectorAll("[data-hero-dot]");
const heroPrev = document.querySelector("[data-hero-prev]");
const heroNext = document.querySelector("[data-hero-next]");
const HERO_CONTENT_SLIDE = 1;
let activeHeroSlide = 0;
let heroSlideTimer;

function setHeaderState() {
  header.classList.toggle("scrolled", window.scrollY > 20);
}

function closeNav() {
  body.classList.remove("nav-open");
  navToggle.setAttribute("aria-expanded", "false");
  navToggle.setAttribute("aria-label", "Open navigation");
}

navToggle.addEventListener("click", () => {
  const isOpen = body.classList.toggle("nav-open");
  navToggle.setAttribute("aria-expanded", String(isOpen));
  navToggle.setAttribute("aria-label", isOpen ? "Close navigation" : "Open navigation");
});

nav.addEventListener("click", (event) => {
  if (event.target.matches("a")) {
    closeNav();
  }
});

window.addEventListener("scroll", setHeaderState, { passive: true });
setHeaderState();

function showHeroSlide(index) {
  activeHeroSlide = (index + heroSlides.length) % heroSlides.length;

  heroSlides.forEach((slide, slideIndex) => {
    slide.classList.toggle("active", slideIndex === activeHeroSlide);
  });

  heroDots.forEach((dot, dotIndex) => {
    const isActive = dotIndex === activeHeroSlide;
    dot.classList.toggle("active", isActive);
    dot.setAttribute("aria-selected", String(isActive));
  });

  if (hero) {
    hero.classList.toggle("hero-content-hidden", activeHeroSlide !== HERO_CONTENT_SLIDE);
  }
}

function startHeroSlider() {
  window.clearInterval(heroSlideTimer);
  heroSlideTimer = window.setInterval(() => {
    showHeroSlide(activeHeroSlide + 1);
  }, 5200);
}

if (heroSlider && heroSlides.length > 1) {
  heroPrev.addEventListener("click", () => {
    showHeroSlide(activeHeroSlide - 1);
    startHeroSlider();
  });

  heroNext.addEventListener("click", () => {
    showHeroSlide(activeHeroSlide + 1);
    startHeroSlider();
  });

  heroDots.forEach((dot, dotIndex) => {
    dot.addEventListener("click", () => {
      showHeroSlide(dotIndex);
      startHeroSlider();
    });
  });

  startHeroSlider();
}

contactForm.addEventListener("submit", async (event) => {
  if (!contactForm.hasAttribute("data-netlify")) {
    return;
  }

  event.preventDefault();
  const submitButton = contactForm.querySelector("button[type='submit']");
  const formData = new FormData(contactForm);
  const encoded = new URLSearchParams(formData).toString();

  submitButton.disabled = true;
  formNote.textContent = "Sending...";

  try {
    const response = await fetch("/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: encoded
    });

    if (!response.ok) {
      throw new Error("Form service unavailable");
    }

    contactForm.reset();
    formNote.textContent = "Thanks. Your message has been sent.";
  } catch (error) {
    const email = "hello@greencleanerspro.com";
    const name = formData.get("name") || "";
    const message = formData.get("message") || "";
    const subject = encodeURIComponent(`Website inquiry from ${name}`);
    const bodyText = encodeURIComponent(message);

    formNote.innerHTML = `This preview cannot send yet. Email <a href="mailto:${email}?subject=${subject}&body=${bodyText}">${email}</a>.`;
  } finally {
    submitButton.disabled = false;
  }
});
