# -*- coding: utf-8 -*-
from odoo import models, fields

class ResConfigSettings(models.TransientModel):
    _inherit = 'res.config.settings'

    iface_surcharge = fields.Boolean(
        related='pos_config_id.iface_surcharge',
        readonly=False,
        string="Credit Card Surcharge"
    )
    surcharge_percentage = fields.Float(
        related='pos_config_id.surcharge_percentage',
        readonly=False,
        string="Surcharge Percentage"
    )
    surcharge_product_id = fields.Many2one(
        'product.product',
        related='pos_config_id.surcharge_product_id',
        readonly=False,
        string="Surcharge Product"
    )
