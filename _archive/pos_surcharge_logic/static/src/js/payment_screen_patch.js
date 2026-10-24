/** @odoo-module */

import { PaymentScreen } from "@point_of_sale/app/screens/payment_screen/payment_screen";
import { Orderline } from "@point_of_sale/app/store/models";
import { patch } from "@web/core/utils/patch";

// Patch PaymentScreen component logic
patch(PaymentScreen.prototype, {
    /**
     * @override
     */
    setup() {
        super.setup(...arguments);
        // Ensure surcharge state is synchronized upon entering the payment screen
        this.updateSurchargeLine();
    },

    /**
     * @override
     */
    async selectPaymentMethod(paymentMethod) {
        const order = this.currentOrder || this.pos.get_order();
        if (order && this.pos.config.iface_surcharge) {
            const surchargeProduct_id = this.pos.config.surcharge_product_id;
            if (surchargeProduct_id) {
                const surchargeProductId = surchargeProduct_id[0];
                
                // If the selected method is 'Credit Card', dynamically inject the surcharge line item
                // before super.selectPaymentMethod runs, so Odoo automatically computes the correct
                // payment line amount based on the updated order total (including the surcharge).
                if (paymentMethod.name === 'Credit Card') {
                    const surchargeLine = order.get_orderlines().find(line => line.product.id === surchargeProductId);
                    if (!surchargeLine) {
                        const surchargePercentage = this.pos.config.surcharge_percentage || 3.99;
                        
                        // Calculate total without surcharge
                        let totalWithoutSurcharge = 0;
                        for (const line of order.get_orderlines()) {
                            if (line.product.id !== surchargeProductId) {
                                totalWithoutSurcharge += line.get_price_with_tax();
                            }
                        }
                        
                        const fee = totalWithoutSurcharge * (surchargePercentage / 100);
                        const product = this.pos.db.get_product_by_id(surchargeProductId);
                        if (product) {
                            order.add_product(product, { quantity: 1, price: fee, merge: false });
                        }
                    }
                }
            }
        }

        // Call base selection logic
        await super.selectPaymentMethod(paymentMethod);

        // Update surcharge line (handles updating/removing logic)
        this.updateSurchargeLine();
    },

    /**
     * @override
     */
    deletePaymentLine(cid) {
        super.deletePaymentLine(cid);
        // Automatically check if surcharge should be updated or removed
        this.updateSurchargeLine();
    },

    /**
     * Helper to keep the surcharge line item in sync with payment methods
     */
    updateSurchargeLine() {
        const order = this.currentOrder || this.pos.get_order();
        if (!order) return;

        const surchargeProduct_id = this.pos.config.surcharge_product_id;
        if (!surchargeProduct_id) return;
        const surchargeProductId = surchargeProduct_id[0];

        const surchargeLine = order.get_orderlines().find(line => line.product.id === surchargeProductId);

        // If surcharge interface is disabled, ensure no surcharge line exists
        if (!this.pos.config.iface_surcharge) {
            if (surchargeLine) {
                order.remove_orderline(surchargeLine);
            }
            return;
        }

        // Check if there is currently any 'Credit Card' payment line in the order
        const hasCreditCard = order.get_paymentlines().some(line => line.payment_method.name === 'Credit Card');

        if (hasCreditCard) {
            const surchargePercentage = this.pos.config.surcharge_percentage || 3.99;
            
            // Calculate total of all lines excluding the surcharge line itself
            let totalWithoutSurcharge = 0;
            for (const line of order.get_orderlines()) {
                if (line.product.id !== surchargeProductId) {
                    totalWithoutSurcharge += line.get_price_with_tax();
                }
            }
            
            const fee = totalWithoutSurcharge * (surchargePercentage / 100);

            if (surchargeLine) {
                // Update price if it has drifted
                if (Math.abs(surchargeLine.get_unit_price() - fee) > 0.001) {
                    surchargeLine.set_unit_price(fee);
                    surchargeLine.price_manually_set = true;
                }
            } else {
                // Add surcharge line if missing
                const product = this.pos.db.get_product_by_id(surchargeProductId);
                if (product) {
                    order.add_product(product, { quantity: 1, price: fee, merge: false });
                }
            }
        } else {
            // No Credit Card payment line exists anymore; remove the surcharge
            if (surchargeLine) {
                order.remove_orderline(surchargeLine);
            }
        }
    }
});

// Patch Orderline prototype to clearly label the product on receipts
patch(Orderline.prototype, {
    /**
     * @override
     */
    export_for_printing() {
        const result = super.export_for_printing(...arguments);
        const surchargeProduct_id = this.pos.config.surcharge_product_id;
        if (surchargeProduct_id && this.product.id === surchargeProduct_id[0]) {
            result.product_name = "Credit Card Surcharge";
        }
        return result;
    }
});
