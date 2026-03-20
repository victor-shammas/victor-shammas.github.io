---
title: "Contact"
description: "Get in touch with Dr. Victor Shammas."
menu:
  main:
    weight: 70
---

# Contact

Feel free to reach out with questions about my research, media inquiries, speaking invitations, or collaboration proposals.

<form action="https://formsubmit.co/82d2495ef1b1b3fe25d52380ffc75a16" method="POST" class="contact-form">

  <!-- Formsubmit configuration -->
  <input type="hidden" name="_subject" value="New message from victorshammas.com">
  <input type="hidden" name="_captcha" value="true">
  <input type="hidden" name="_next" value="https://victor-shammas.github.io/contact-thanks/">
  <input type="text" name="_honey" style="display:none">

  <div class="form-group">
    <label for="name">Name</label>
    <input type="text" name="name" id="name" required placeholder="Your name">
  </div>

  <div class="form-group">
    <label for="email">Email</label>
    <input type="email" name="email" id="email" required placeholder="your@email.com">
  </div>

  <div class="form-group">
    <label for="subject">Subject</label>
    <input type="text" name="subject" id="subject" required placeholder="Subject">
  </div>

  <div class="form-group">
    <label for="message">Message</label>
    <textarea name="message" id="message" rows="6" required placeholder="Your message..."></textarea>
  </div>

  <button type="submit">Send Message</button>

</form>

<style>
.contact-form {
  max-width: 600px;
  margin-top: 1.5rem;
}
.contact-form .form-group {
  margin-bottom: 1.25rem;
}
.contact-form label {
  display: block;
  margin-bottom: 0.35rem;
  font-weight: 600;
  font-size: 0.95rem;
}
.contact-form input[type="text"],
.contact-form input[type="email"],
.contact-form textarea {
  width: 100%;
  padding: 0.6rem 0.75rem;
  border: 1px solid #ccc;
  border-radius: 4px;
  font-size: 1rem;
  font-family: inherit;
  background: #fff;
  box-sizing: border-box;
  transition: border-color 0.2s;
}
.contact-form input:focus,
.contact-form textarea:focus {
  outline: none;
  border-color: #333;
}
.contact-form textarea {
  resize: vertical;
}
.contact-form button[type="submit"] {
  display: inline-block;
  padding: 0.65rem 1.75rem;
  background: #333;
  color: #fff;
  border: none;
  border-radius: 4px;
  font-size: 1rem;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.2s;
}
.contact-form button[type="submit"]:hover {
  background: #555;
}
</style>
