# -*- coding: utf-8 -*-
from odoo import models, fields, api
from odoo.exceptions import ValidationError

class PosConfig(models.Model):
    _inherit = 'pos.config'

    iface_surcharge = fields.Boolean(
        string="Enable Credit Card Surcharge",
        default=True,
        help="Check this box to automatically apply a surcharge fee when the Credit Card payment method is selected."
    )
    surcharge_percentage = fields.Float(
        string="Surcharge Percentage",
        default=3.99,
        help="Percentage fee to add for credit card payments (e.g. 3.99 for 3.99%). Maximum legal limit in the U.S. is 4.0%."
    )
    surcharge_product_id = fields.Many2one(
        'product.product',
        string="Surcharge Product",
        domain=[('type', '=', 'service')],
        help="The service product used to represent the Credit Card Surcharge line item."
    )

    @api.constrains('surcharge_percentage')
    def _check_surcharge_percentage(self):
        for config in self:
            if config.surcharge_percentage > 4.0:
                raise ValidationError("Compliance Capping Rule: The surcharge fee percentage cannot exceed the legal cap of 4.0%.")
            if config.surcharge_percentage < 0.0:
                raise ValidationError("The surcharge fee percentage cannot be negative.")
