import {
  Component, Input, Output, EventEmitter, inject, computed, signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { StateService } from '../../../../core/services/state.service';
import { ConfigService } from '../../../../core/services/config.service';

@Component({
  selector: 'app-budget-bar',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="budget-bar-wrapper">
      <div class="budget-values">{{ Math.round(todayTotal()) }} / {{ budget() }} kcal</div>
      <div class="budget-bar-track">
        <div
          class="budget-bar-fill"
          [style.width.%]="pct()"
          [style.background]="gradientStyle()"
          [style.box-shadow]="overBudget() ? 'inset 0 0 0 2px rgba(255,59,48,0.12)' : 'none'"
        >
          <span
            class="budget-seg"
            [style.width.%]="fracFat() * 100"
            [title]="'Fat: ' + Math.round(macros().fat) + ' g (' + Math.round(fracFat() * 100) + '%)'"
          ></span>
          <span
            class="budget-seg"
            [style.width.%]="fracProtein() * 100"
            [title]="'Protein: ' + Math.round(macros().protein) + ' g (' + Math.round(fracProtein() * 100) + '%)'"
          ></span>
          <span
            class="budget-seg"
            [style.width.%]="fracCarbs() * 100"
            [title]="'Carbs: ' + Math.round(macros().carbs) + ' g (' + Math.round(fracCarbs() * 100) + '%)'"
          ></span>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .budget-bar-wrapper { padding: 4px 0 8px; }
    .budget-values { font-size: 13px; color: var(--text-secondary); margin-bottom: 6px; }
    .budget-bar-track {
      height: 10px; background: var(--border); border-radius: 6px; overflow: hidden;
    }
    .budget-bar-fill {
      height: 100%; border-radius: 6px; transition: width 0.3s ease; display: flex;
    }
    .budget-seg { height: 100%; display: block; min-width: 2px; }
  `],
})
export class BudgetBarComponent {
  readonly Math = Math;
  private readonly state = inject(StateService);
  private readonly config = inject(ConfigService);

  readonly todayTotal = this.state.todayCalories;
  readonly macros = this.state.todayMacros;
  readonly budget = computed(() => parseInt(String(this.config.getConfig('dailyBudget') ?? 2000), 10) || 2000);
  readonly pct = computed(() => {
    const b = this.budget();
    return b > 0 ? Math.min(100, Math.round((this.todayTotal() / b) * 100)) : 0;
  });
  readonly overBudget = computed(() => this.todayTotal() > this.budget() && this.budget() > 0);

  readonly calFromFat = computed(() => this.macros().fat * 9);
  readonly calFromProtein = computed(() => this.macros().protein * 4);
  readonly calFromCarbs = computed(() => this.macros().carbs * 4);
  readonly totalMacroCal = computed(() => this.calFromFat() + this.calFromProtein() + this.calFromCarbs());

  readonly fracFat = computed(() => this.totalMacroCal() > 0 ? this.calFromFat() / this.totalMacroCal() : 0);
  readonly fracProtein = computed(() => this.totalMacroCal() > 0 ? this.calFromProtein() / this.totalMacroCal() : 0);
  readonly fracCarbs = computed(() => this.totalMacroCal() > 0 ? this.calFromCarbs() / this.totalMacroCal() : 0);

  readonly gradientStyle = computed(() => {
    if (this.totalMacroCal() <= 0) return 'transparent';
    const s1 = Math.round(this.fracFat() * 100);
    const s2 = Math.round((this.fracFat() + this.fracProtein()) * 100);
    return `linear-gradient(90deg, #ff3b30 0% ${s1}%, #34c759 ${s1}% ${s2}%, #007aff ${s2}% 100%)`;
  });
}
