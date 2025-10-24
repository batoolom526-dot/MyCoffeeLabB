// ======= CONFIG =======
const ADMIN_PASSWORD = "1234"; // change this to your own
// =======================

function addToCart(btn){
  const item = btn.parentElement;
  const name = item.dataset.name;
  const price = parseFloat(item.dataset.price);
  let cart = JSON.parse(localStorage.getItem("cart") || "[]");
  cart.push({ item: name, price, count: 1 });
  localStorage.setItem("cart", JSON.stringify(cart));
  updateCart();
}

function updateCart(){
  const cart = JSON.parse(localStorage.getItem("cart") || "[]");
  const cartList = document.getElementById("cartItems");
  const totalElement = document.getElementById("cartTotal");
  if(!cartList) return;
  cartList.innerHTML = "";
  let total = 0;
  cart.forEach(i=>{
    total += i.price * i.count;
    const li = document.createElement("li");
    li.textContent = `${i.item} - $${i.price.toFixed(2)}`;
    cartList.appendChild(li);
  });
  totalElement.textContent = `Total: $${total.toFixed(2)}`;
  localStorage.setItem("cartTotal", total);
}

function sendOrderToCRM(order){
  const all = JSON.parse(localStorage.getItem("orders") || "[]");
  order.id = Date.now();
  order.createdAt = new Date().toLocaleString();
  all.push(order);
  localStorage.setItem("orders", JSON.stringify(all));
  console.log("Order saved:", order);
}

// ==== ADMIN ====
function checkAdmin(){
  const pass = document.getElementById("adminPass").value;
  if(pass === ADMIN_PASSWORD){
    document.getElementById("loginSection").style.display = "none";
    document.getElementById("adminContent").style.display = "block";
    loadOrders();
  } else {
    alert("Incorrect password");
  }
}

function loadOrders(){
  const orders = JSON.parse(localStorage.getItem("orders") || "[]");
  const tbody = document.querySelector("#ordersTable tbody");
  tbody.innerHTML = "";
  orders.forEach(o=>{
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${o.name||""}</td>
      <td>${o.phone||""}</td>
      <td>${o.email||""}</td>
      <td>${(o.items||[]).map(i=>`${i.item} x${i.count||1}`).join("; ")}</td>
      <td>$${o.total||0}</td>
      <td>${o.message||""}</td>
    `;
    tbody.appendChild(row);
  });
}

function exportOrdersCSV(){
  const orders = JSON.parse(localStorage.getItem("orders") || "[]");
  if(!orders.length) return alert("No orders yet.");
  let csv = "Name,Phone,Email,Items,Total,Message\n";
  orders.forEach(o=>{
    const items = (o.items||[]).map(i=>`${i.item} x${i.count||1}`).join("; ");
    csv += `"${o.name}","${o.phone}","${o.email}","${items}","${o.total}","${o.message}"\n`;
  });
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "orders.csv";
  a.click();
}

// ===== Reviews & Cups-driven Rating =====
// Two-way binding between number-of-cups and bean rating.
function updateBeanUI(rating){
  rating = Math.max(1, Math.min(5, Number(rating) || 1));
  const beanBtns = document.querySelectorAll('.bean-btn');
  beanBtns.forEach(btn => {
    const val = Number(btn.dataset.value);
    btn.classList.toggle('active', val <= rating);
  });
  const display = document.getElementById('r-rating-display');
  const hidden = document.getElementById('r-rating');
  const cups = document.getElementById('r-cups');
  if(display) display.textContent = rating;
  if(hidden) hidden.value = rating;
  if(cups) cups.value = rating;
}

function saveReviewLocally(review){
  const arr = JSON.parse(localStorage.getItem('reviews')||'[]');
  arr.push(review);
  localStorage.setItem('reviews', JSON.stringify(arr));
}

async function postReview(review){
  review.ts = Date.now();
  try{
    const res = await fetch('/api/reviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(review),
    });
    if(!res.ok) throw new Error('Server error');
    return await res.json();
  }catch(e){
    // fallback: store locally so site still works without server
    saveReviewLocally(review);
    return { local: true };
  }
}

async function getReviews(){
  try{
    const res = await fetch('/api/reviews');
    if(!res.ok) throw new Error('Network');
    return await res.json();
  }catch(e){
    return JSON.parse(localStorage.getItem('reviews')||'[]');
  }
}

function renderReviews(rows){
  const container = document.getElementById('reviews-list');
  if(!container) return;
  if(!rows || rows.length === 0){ container.innerHTML = '<p>No reviews yet.</p>'; return; }
  container.innerHTML = '';
  rows.forEach(r => {
    const beans = Array.from({length: r.rating}).map(()=> '☕').join(' ');
    const fav = r.favoriteItem ? `<p style="font-weight:600;color:#8c5f35;">Favorite: ${r.favoriteItem}</p>` : '';
    const phone = r.phone ? `<p style="font-size:0.95em;color:#555;">Phone: ${r.phone}</p>` : '';
    const html = `
      <article class="review">
        <h3>${r.name || 'Anonymous'} <small>(${new Date(r.ts).toLocaleString()})</small></h3>
        ${phone}
        <p>${beans} <small style="color:#8c5f35;font-weight:700;">(${r.rating}/5)</small></p>
        ${fav}
        <p>${r.comment || ''}</p>
      </article>
    `;
    container.insertAdjacentHTML('beforeend', html);
  });
}

function initReviewUI(){
  // create cups input if missing
  const ratingWrap = document.getElementById('bean-rating');
  if(ratingWrap && !document.getElementById('r-cups')){
    const el = document.createElement('input');
    el.type = 'number'; el.id = 'r-cups'; el.min = 1; el.max = 5; el.value = 5; el.style.width = '64px';
    el.title = 'Number of cups (1-5)';
    ratingWrap.parentElement.insertAdjacentElement('afterend', el);
  }

  // wire bean buttons
  document.querySelectorAll('.bean-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      const v = Number(btn.dataset.value) || 1;
      updateBeanUI(v);
    });
  });

  // wire cups input
  const cups = document.getElementById('r-cups');
  if(cups){
    cups.addEventListener('input', e => {
      let v = Math.round(Number(e.target.value) || 1);
      v = Math.max(1, Math.min(5, v));
      updateBeanUI(v);
    });
  }

  // form submit
  const form = document.getElementById('review-form');
  if(form){
    form.addEventListener('submit', async (ev) =>{
      ev.preventDefault();
      const review = {
        name: document.getElementById('r-name').value,
        phone: document.getElementById('r-phone').value,
        rating: Number(document.getElementById('r-rating').value) || 1,
        comment: document.getElementById('r-comment').value,
        favoriteItem: document.getElementById('r-favorite').value,
      };
      await postReview(review);
      // refresh list from server/local
      const rows = await getReviews();
      renderReviews(rows);
      form.reset();
      updateBeanUI(5);
      alert('Thanks for your review!');
    });
  }

  // initial UI
  updateBeanUI(5);
  // load and render reviews
  getReviews().then(renderReviews);
}

// initialize when DOM ready
document.addEventListener('DOMContentLoaded', () => {
  try{ initReviewUI(); }catch(e){ console.error('initReviewUI failed', e); }
});


