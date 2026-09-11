const body = document.body;
const header = document.querySelector("[data-header]");
const navToggle = document.querySelector("[data-nav-toggle]");
const nav = document.querySelector("[data-nav]");
const contactForm = document.querySelector("[data-contact-form]");
const formNote = document.querySelector("[data-form-note]");

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
