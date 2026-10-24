// ==========================================================================
// POS Surcharge Prototype State & Logic (OWL Simulation)
// ==========================================================================

// Mock Products Database
const PRODUCTS = [
    { id: 1, name: "Cheeseburger Deluxe", price: 9.99, icon: "fa-solid fa-hamburger" },
    { id: 2, name: "Pepperoni Pizza Slice", price: 4.50, icon: "fa-solid fa-pizza-slice" },
    { id: 3, name: "Golden French Fries", price: 3.25, icon: "fa-solid fa-pepper-hot" },
    { id: 4, name: "Craft Soda Pop", price: 2.50, icon: "fa-solid fa-glass-water" },
    { id: 5, name: "Hot Cappuccino", price: 3.75, icon: "fa-solid fa-mug-hot" },
    { id: 6, name: "Organic Caesar Salad", price: 7.99, icon: "fa-solid fa-leaf" }
];

// Special Surcharge Product Details
const SURCHARGE_PRODUCT = {
    id: 999, // Unique virtual ID
    name: "Credit Card Processing Fee",
    price: 0.00, // Determined dynamically
    icon: "fa-solid fa-percent"
};

// Application State
let order = {
    lines: [],     // { product, quantity, price }
    payments: []   // { method, amount }
};

let config = {
    iface_surcharge: true,
    surcharge_percentage: 3.99
};

// UI Elements caching
const productsGrid = document.getElementById("products-grid-container");
const orderlinesList = document.getElementById("orderlines-list");
const subtotalVal = document.getElementById("subtotal-val");
const taxVal = document.getElementById("tax-val");
const surchargeRowIndicator = document.getElementById("surcharge-row-indicator");
const surchargeVal = document.getElementById("surcharge-val");
const totalVal = document.getElementById("total-val");
const paymentLinesBody = document.getElementById("payment-lines-body");
const paymentRemaining = document.getElementById("payment-remaining");
const paymentPaid = document.getElementById("payment-paid");
const btnValidate = document.getElementById("btn-validate");

// Initialize application
document.addEventListener("DOMContentLoaded", () => {
    renderProducts();
    updateOrderSummary();
});

// Render Product Grid
function renderProducts() {
    productsGrid.innerHTML = "";
    PRODUCTS.forEach(product => {
        const card = document.createElement("div");
        card.className = "product-card";
        card.onclick = () => addProductToOrder(product);
        card.innerHTML = `
            <i class="${product.icon} product-icon"></i>
            <span class="product-name">${product.name}</span>
            <span class="product-price">$${product.price.toFixed(2)}</span>
        `;
        productsGrid.appendChild(card);
    });
}

// Add Product to Order (Simulating order.add_product)
function addProductToOrder(product) {
    // Prevent adding surcharge product manually
    if (product.id === SURCHARGE_PRODUCT.id) return;

    const existingLine = order.lines.find(line => line.product.id === product.id);
    if (existingLine) {
        existingLine.quantity += 1;
    } else {
        order.lines.push({
            product: product,
            quantity: 1,
            price: product.price
        });
    }
    
    // Automatically recalculate totals and refresh summary
    updateOrderSummary();
    
    // If on payment tab, also keep payment values in sync
    updatePaymentDetails();
}

// Remove Line from Cart
function removeOrderline(productId) {
    order.lines = order.lines.filter(line => line.product.id !== productId);
    
    // If the cart becomes empty, remove the surcharge fee line as well
    if (order.lines.length === 0 || (order.lines.length === 1 && order.lines[0].product.id === SURCHARGE_PRODUCT.id)) {
        order.lines = [];
        order.payments = [];
    }

    updateOrderSummary();
    updatePaymentDetails();
}

// Core Recalculation & Update Logic (Simulating Odoo state updates)
function updateOrderSummary() {
    if (order.lines.length === 0) {
        orderlinesList.innerHTML = `
            <li class="empty-cart-message">
                <i class="fa-solid fa-basket-shopping"></i>
                <p>Cart is empty. Add products to start.</p>
            </li>
        `;
        subtotalVal.innerText = "$0.00";
        taxVal.innerText = "$0.00";
        surchargeRowIndicator.classList.add("hidden");
        totalVal.innerText = "$0.00";
        return;
    }

    // 1. Check if Surcharge Product needs to be added/updated/removed
    const hasCreditCardPayment = order.payments.some(p => p.method === "Credit Card");
    const surchargeLineIndex = order.lines.findIndex(line => line.product.id === SURCHARGE_PRODUCT.id);

    if (config.iface_surcharge && hasCreditCardPayment) {
        // Compute total without the surcharge line item
        let totalWithoutSurcharge = 0;
        order.lines.forEach(line => {
            if (line.product.id !== SURCHARGE_PRODUCT.id) {
                // Apply a simple 10% tax internally to match 'get_price_with_tax'
                const linePriceWithTax = (line.price * line.quantity) * 1.10;
                totalWithoutSurcharge += linePriceWithTax;
            }
        });

        // Compute fee
        const fee = totalWithoutSurcharge * (config.surcharge_percentage / 100);

        if (surchargeLineIndex !== -1) {
            // Update existing fee line price
            order.lines[surchargeLineIndex].price = fee;
        } else {
            // Inject new CC Surcharge Fee line
            order.lines.push({
                product: SURCHARGE_PRODUCT,
                quantity: 1,
                price: fee
            });
        }
    } else {
        // Surcharge is disabled or no Credit Card line selected; remove the surcharge item if it exists
        if (surchargeLineIndex !== -1) {
            order.lines.splice(surchargeLineIndex, 1);
        }
    }

    // 2. Render Order Lines in UI
    orderlinesList.innerHTML = "";
    
    let subtotal = 0;
    let tax = 0;
    let surcharge = 0;

    order.lines.forEach(line => {
        const isSurcharge = line.product.id === SURCHARGE_PRODUCT.id;
        const lineTotal = line.price * line.quantity;

        if (isSurcharge) {
            surcharge = lineTotal;
        } else {
            subtotal += lineTotal;
            tax += lineTotal * 0.10; // 10% tax rate
        }

        const li = document.createElement("li");
        li.className = `orderline-item ${isSurcharge ? 'surcharge-line' : ''}`;
        li.innerHTML = `
            <div class="line-info">
                <span class="line-title">${isSurcharge ? 'Credit Card Surcharge' : line.product.name}</span>
                <span class="line-meta">${isSurcharge ? 'Processing Service Fee' : `${line.quantity}x @ $${line.price.toFixed(2)}`}</span>
            </div>
            <div class="line-actions">
                <span class="line-price">$${lineTotal.toFixed(2)}</span>
                ${isSurcharge ? '' : `
                    <button class="line-delete-btn" onclick="removeOrderline(${line.product.id})">
                        <i class="fa-solid fa-circle-xmark"></i>
                    </button>
                `}
            </div>
        `;
        orderlinesList.appendChild(li);
    });

    // 3. Update totals in UI
    const grandTotal = subtotal + tax + surcharge;
    
    subtotalVal.innerText = `$${subtotal.toFixed(2)}`;
    taxVal.innerText = `$${tax.toFixed(2)}`;
    
    if (surcharge > 0) {
        surchargeRowIndicator.classList.remove("hidden");
        surchargeVal.innerText = `$${surcharge.toFixed(2)}`;
    } else {
        surchargeRowIndicator.classList.add("hidden");
    }
    
    totalVal.innerText = `$${grandTotal.toFixed(2)}`;
}

// Switch UI Navigation Tabs
function switchTab(tabId) {
    // Update active tab buttons
    document.querySelectorAll(".tab-btn").forEach(btn => btn.classList.remove("active"));
    document.getElementById(`tab-${tabId}`).classList.add("active");

    // Update active tab content panels
    document.querySelectorAll(".tab-content").forEach(content => content.classList.remove("active"));
    document.getElementById(`content-${tabId}`).classList.add("active");

    // If switching to payment tab, synchronize screen values
    if (tabId === "payment") {
        updatePaymentDetails();
    }
}

// Select/Click a Payment Method (Simulating selectPaymentMethod)
function selectPaymentMethod(method) {
    if (order.lines.length === 0) {
        alert("Cart is empty! Add products first.");
        switchTab("products");
        return;
    }

    // Avoid adding duplicate payment lines for same method
    if (order.payments.some(p => p.method === method)) {
        return;
    }

    // Trigger Condition check: If method is Credit Card, inject surcharge BEFORE Odoo processes payment amount
    if (method === "Credit Card" && config.iface_surcharge) {
        // Simulate immediate surcharge injection before payment calculation
        const surchargeProductInCart = order.lines.some(l => l.product.id === SURCHARGE_PRODUCT.id);
        if (!surchargeProductInCart) {
            // Force temporary mock payment line to trigger state update
            order.payments.push({ method: "Credit Card", amount: 0 }); 
            updateOrderSummary();
            // Remove the temporary payment line; it will be re-added below with correct amount
            order.payments = order.payments.filter(p => p.method !== "Credit Card");
        }
    }

    // Calculate remaining amount due
    const totalDue = getGrandTotal();
    const totalPaid = order.payments.reduce((sum, p) => sum + p.amount, 0);
    const remaining = Math.max(0, totalDue - totalPaid);

    if (remaining > 0) {
        order.payments.push({
            method: method,
            amount: remaining
        });
    }

    // Refresh state
    updateOrderSummary();
    updatePaymentDetails();
}

// Delete Payment Line (Simulating deletePaymentLine)
function deletePaymentLine(index) {
    order.payments.splice(index, 1);
    
    // Refresh totals (if Credit Card was deleted, surcharge is auto-removed)
    updateOrderSummary();
    updatePaymentDetails();
}

// Update Payment Interface Values
function updatePaymentDetails() {
    paymentLinesBody.innerHTML = "";
    
    if (order.payments.length === 0) {
        paymentLinesBody.innerHTML = `
            <tr class="empty-payment-row">
                <td colspan="3" class="text-center text-muted">No payment lines added.</td>
            </tr>
        `;
        paymentRemaining.innerText = `$${getGrandTotal().toFixed(2)}`;
        paymentPaid.innerText = "$0.00";
        btnValidate.disabled = true;
        return;
    }

    order.payments.forEach((payment, index) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td class="font-weight-bold"><i class="fa-solid ${payment.method === 'Cash' ? 'fa-money-bill-wave text-success' : 'fa-credit-card text-primary'}"></i> ${payment.method}</td>
            <td class="font-weight-bold">$${payment.amount.toFixed(2)}</td>
            <td>
                <button class="btn btn-danger-outline btn-sm" onclick="deletePaymentLine(${index})">
                    <i class="fa-solid fa-trash-can"></i> Delete
                </button>
            </td>
        `;
        paymentLinesBody.appendChild(tr);
    });

    const totalDue = getGrandTotal();
    const totalPaid = order.payments.reduce((sum, p) => sum + p.amount, 0);
    const remaining = Math.max(0, totalDue - totalPaid);

    paymentRemaining.innerText = `$${remaining.toFixed(2)}`;
    paymentPaid.innerText = `$${totalPaid.toFixed(2)}`;

    // Enable Validate button if the order is fully paid (remaining <= 0)
    btnValidate.disabled = remaining > 0.01;
}

// Get final grand total
function getGrandTotal() {
    let subtotal = 0;
    let tax = 0;
    let surcharge = 0;

    order.lines.forEach(line => {
        const lineTotal = line.price * line.quantity;
        if (line.product.id === SURCHARGE_PRODUCT.id) {
            surcharge = lineTotal;
        } else {
            subtotal += lineTotal;
            tax += lineTotal * 0.10;
        }
    });

    return subtotal + tax + surcharge;
}

// Clear active order
document.getElementById("clear-order-btn").onclick = () => {
    order.lines = [];
    order.payments = [];
    updateOrderSummary();
    updatePaymentDetails();
};

// ==========================================================================
// Config Panel Settings Logic & Compliance Safeguards
// ==========================================================================

function toggleConfigSurcharge() {
    config.iface_surcharge = document.getElementById("config-iface-surcharge").checked;
    
    // Toggle subfields display visibility
    const subfields = document.getElementById("surcharge-config-subfields");
    if (config.iface_surcharge) {
        subfields.style.opacity = "1";
        subfields.style.pointerEvents = "auto";
    } else {
        subfields.style.opacity = "0.5";
        subfields.style.pointerEvents = "none";
    }

    // Refresh calculations immediately
    updateOrderSummary();
    updatePaymentDetails();
}

function updateConfigPercentage(val) {
    const percentage = parseFloat(val);
    const warningEl = document.getElementById("percentage-cap-warning");
    
    if (isNaN(percentage) || percentage < 0) {
        config.surcharge_percentage = 0.00;
        return;
    }

    // COMPLIANCE CAPPING RULE
    // Flag warning if manager attempts to enter value exceeding the U.S. 4% standard cap
    if (percentage > 4.0) {
        warningEl.classList.remove("hidden");
    } else {
        warningEl.classList.add("hidden");
    }

    config.surcharge_percentage = percentage;

    // Refresh calculations immediately
    updateOrderSummary();
    updatePaymentDetails();
}

// ==========================================================================
// Receipt Modal / Printing Action
// ==========================================================================

function validateOrder() {
    const receiptModal = document.getElementById("receipt-modal");
    const receiptItemsBody = document.getElementById("receipt-items-body");
    const receiptSubtotal = document.getElementById("receipt-subtotal");
    const receiptTax = document.getElementById("receipt-tax");
    const receiptSurchargeRow = document.getElementById("receipt-surcharge-row");
    const receiptSurcharge = document.getElementById("receipt-surcharge");
    const receiptTotal = document.getElementById("receipt-total");
    const receiptPaymentsList = document.getElementById("receipt-payments-list");

    // Clear previous receipt details
    receiptItemsBody.innerHTML = "";
    receiptPaymentsList.innerHTML = "";

    // Set Date
    const now = new Date();
    document.getElementById("receipt-date").innerText = now.toLocaleString();

    let subtotal = 0;
    let tax = 0;
    let surcharge = 0;

    // Load items in receipt
    order.lines.forEach(line => {
        const isSurcharge = line.product.id === SURCHARGE_PRODUCT.id;
        const lineTotal = line.price * line.quantity;

        if (isSurcharge) {
            surcharge = lineTotal;
        } else {
            subtotal += lineTotal;
            tax += lineTotal * 0.10;

            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td>${line.product.name}</td>
                <td class="text-right">${line.quantity}</td>
                <td class="text-right">$${lineTotal.toFixed(2)}</td>
            `;
            receiptItemsBody.appendChild(tr);
        }
    });

    // Subtotal and Tax
    receiptSubtotal.innerText = `$${subtotal.toFixed(2)}`;
    receiptTax.innerText = `$${tax.toFixed(2)}`;

    // COMPLIANCE RECEIPT TRANSPARENCY RULE:
    // Clearly label the fee as "Credit Card Surcharge" on printed receipts
    if (surcharge > 0) {
        receiptSurchargeRow.classList.remove("hidden");
        receiptSurcharge.innerText = `$${surcharge.toFixed(2)}`;
    } else {
        receiptSurchargeRow.classList.add("hidden");
    }

    const grandTotal = subtotal + tax + surcharge;
    receiptTotal.innerText = `$${grandTotal.toFixed(2)}`;

    // Payments list
    order.payments.forEach(payment => {
        const pRow = document.createElement("div");
        pRow.className = "r-row";
        pRow.innerHTML = `
            <span>${payment.method}:</span>
            <span>$${payment.amount.toFixed(2)}</span>
        `;
        receiptPaymentsList.appendChild(pRow);
    });

    // Show modal
    receiptModal.classList.remove("hidden");
}

function closeReceiptModal() {
    // Reset order state for the next customer
    order.lines = [];
    order.payments = [];
    
    updateOrderSummary();
    updatePaymentDetails();
    
    // Close modal & return to products
    document.getElementById("receipt-modal").classList.add("hidden");
    switchTab("products");
}
