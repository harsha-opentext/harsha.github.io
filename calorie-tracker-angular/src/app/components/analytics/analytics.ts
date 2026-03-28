import { Component, OnInit, AfterViewInit, OnDestroy, inject, ViewChild, ElementRef, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { State } from '../../services/state';
import { Github } from '../../services/github';
import { Logger } from '../../services/logger';
import { Config } from '../../services/config';
import { Entry } from '../../models/entry.model';
import { Chart, registerables, ChartConfiguration } from 'chart.js';

Chart.register(...registerables);

@Component({
  selector: 'app-analytics',
  imports: [CommonModule, FormsModule],
  templateUrl: './analytics.html',
  styleUrl: './analytics.scss'
})
export class Analytics implements OnInit, AfterViewInit, OnDestroy {
  private state = inject(State);
  private github = inject(Github);
  private logger = inject(Logger);
  private config = inject(Config);
  private cdr = inject(ChangeDetectorRef);
  
  @ViewChild('lineChart') lineChartRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('mealChart') mealChartRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('doughnutChart') doughnutChartRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('barChart') barChartRef!: ElementRef<HTMLCanvasElement>;

  entries: Entry[] = [];
  totalCalories = 0;
  avgCalories = 0;
  totalDays = 0;
  viewMode: 'period' | 'single' = 'period';
  timePeriod = '7';
  selectedDate: string = '';
  loading = false;

  private charts: { [key: string]: Chart } = {};
  
  private getLocalISODate(d: Date): string {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  
  ngOnInit(): void {
    // Set default date to today
    this.selectedDate = this.getLocalISODate(new Date());
    
    // Initial load
    this.loadData();
    
    this.state.state$.subscribe(state => {
      this.entries = state.entries;
      this.calculateStats();
      this.updateCharts();
    });
  }

  async loadData(): Promise<void> {
    if (!this.config.hasCredentials()) return;
    
    try {
      this.loading = true;
      
      if (this.viewMode === 'single') {
        // Load single day
        const dateStr = this.selectedDate;
        const currentState = this.state.getState();
        
        if (!currentState.dailyDataMap.has(dateStr)) {
          this.logger.info(`Analytics: Fetching single day ${dateStr}`);
          const dataMap = await this.github.fetchMultipleDays([dateStr]);
          
          const newEntries: Entry[] = [];
          dataMap.forEach(data => {
            this.state.setDailyData(data.date, data);
            newEntries.push(...data.entries);
          });

          if (newEntries.length > 0) {
            const existingTimestamps = new Set(currentState.entries.map(e => e.timestamp));
            const uniqueNew = newEntries.filter(e => !existingTimestamps.has(e.timestamp));
            if (uniqueNew.length > 0) {
              this.state.setEntries([...currentState.entries, ...uniqueNew]);
            }
          }
        }
      } else {
        // Load period
        const days = this.timePeriod === 'all' ? 90 : parseInt(this.timePeriod);
        const datesToFetch: string[] = [];
        const today = new Date();
        const currentState = this.state.getState();
        
        for (let i = 0; i < days; i++) {
          const d = new Date(today);
          d.setDate(today.getDate() - i);
          const dateStr = this.getLocalISODate(d);
          
          if (!currentState.dailyDataMap.has(dateStr)) {
            datesToFetch.push(dateStr);
          }
        }

        if (datesToFetch.length > 0) {
          this.logger.info(`Analytics: Fetching ${datesToFetch.length} days of data`);
          const dataMap = await this.github.fetchMultipleDays(datesToFetch);
          
          const newEntries: Entry[] = [];
          dataMap.forEach(data => {
            this.state.setDailyData(data.date, data);
            newEntries.push(...data.entries);
          });

          if (newEntries.length > 0) {
            const existingTimestamps = new Set(currentState.entries.map(e => e.timestamp));
            const uniqueNew = newEntries.filter(e => !existingTimestamps.has(e.timestamp));
            if (uniqueNew.length > 0) {
              this.state.setEntries([...currentState.entries, ...uniqueNew]);
            }
          }
        }
      }
    } catch (error) {
      this.logger.error('Failed to load analytics data', error);
    } finally {
      this.loading = false;
      this.cdr.markForCheck();
    }
  }

  onPeriodChange(): void {
    this.loadData();
    this.cdr.detectChanges(); // Ensure view updates before rendering charts
    this.updateCharts();
  }

  onViewModeChange(): void {
    this.loadData();
    this.cdr.detectChanges(); // Ensure view updates before rendering charts
    this.updateCharts();
  }

  onDateChange(): void {
    this.loadData();
    this.cdr.detectChanges(); // Ensure view updates before rendering charts
    this.updateCharts();
  }

  ngAfterViewInit(): void {
    this.updateCharts();
  }

  ngOnDestroy(): void {
    Object.values(this.charts).forEach(chart => chart.destroy());
  }
  
  calculateStats(): void {
    const filtered = this.getFilteredEntries();
    this.totalCalories = filtered.reduce((sum, e) => sum + (e.calories || 0), 0);
    const uniqueDates = new Set(filtered.map(e => e.date));
    this.totalDays = uniqueDates.size;
    this.avgCalories = this.totalDays > 0 ? Math.round(this.totalCalories / this.totalDays) : 0;
  }

  getFilteredEntries(): Entry[] {
    if (!this.entries.length) return [];
    
    if (this.viewMode === 'single') {
      // Return entries for the selected date only
      return this.entries.filter(e => e.date === this.selectedDate);
    }
    
    // Period mode
    const now = new Date();
    const period = this.timePeriod === 'all' ? 36500 : parseInt(this.timePeriod);
    const cutoff = new Date();
    cutoff.setDate(now.getDate() - period);
    const cutoffStr = this.getLocalISODate(cutoff);

    return this.entries.filter(e => e.date >= cutoffStr).sort((a, b) => a.date.localeCompare(b.date));
  }
  
  updateCharts(): void {
    // Wait for view to be ready (especially after *ngIf changes)
    setTimeout(() => {
      const data = this.getFilteredEntries();
      if (!data.length) return;

      if (this.viewMode === 'period') {
        if (this.lineChartRef?.nativeElement) this.renderLineChart(data);
        if (this.barChartRef?.nativeElement) this.renderBarChart(data);
      } else {
        if (this.mealChartRef?.nativeElement) this.renderMealChart(data);
      }
      
      if (this.doughnutChartRef?.nativeElement) {
        this.renderDoughnutChart(data);
      }
    }, 0);
  }

  private renderLineChart(data: Entry[]): void {
    const ctx = this.lineChartRef.nativeElement.getContext('2d');
    if (!ctx) return;

    // Group by date
    const dailyCalories: { [date: string]: number } = {};
    data.forEach(e => {
      dailyCalories[e.date] = (dailyCalories[e.date] || 0) + (e.calories || 0);
    });

    const labels = Object.keys(dailyCalories).sort();
    const values = labels.map(d => dailyCalories[d]);

    if (this.charts['line']) this.charts['line'].destroy();

    this.charts['line'] = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Daily Calories',
          data: values,
          borderColor: '#007aff',
          backgroundColor: 'rgba(0, 122, 255, 0.1)',
          fill: true,
          tension: 0.4
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false }
        },
        scales: {
          y: { beginAtZero: true }
        }
      }
    });
  }

  private renderMealChart(data: Entry[]): void {
    const ctx = this.mealChartRef.nativeElement.getContext('2d');
    if (!ctx) return;

    // Group calories by time/meal
    const mealData: { [key: string]: number } = {};
    data.forEach(e => {
      const time = e['time'] || 'No Time';
      mealData[time] = (mealData[time] || 0) + (e.calories || 0);
    });

    const labels = Object.keys(mealData);
    const values = labels.map(k => mealData[k]);
    const colors = ['#007aff', '#5856d6', '#34c759', '#ff9500', '#ff3b30', '#af52de'];

    if (this.charts['meal']) this.charts['meal'].destroy();

    this.charts['meal'] = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: colors,
          hoverOffset: 4
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'bottom' },
          title: { display: true, text: 'Calories by Meal Time' },
          tooltip: {
            callbacks: {
              label: (context) => {
                const label = context.label || '';
                const value = Number(context.raw || 0);
                return `${label}: ${Math.round(value)} kcal`;
              }
            }
          }
        }
      }
    });
  }

  private renderDoughnutChart(data: Entry[]): void {
    const ctx = this.doughnutChartRef.nativeElement.getContext('2d');
    if (!ctx) return;

    // Macro Distribution (Protein, Carbs, Fat)
    let totalProtein = 0;
    let totalCarbs = 0;
    let totalFat = 0;

    data.forEach(e => {
      totalProtein += Number(e.protein || 0);
      totalCarbs += Number(e.carbs || 0);
      totalFat += Number(e.fat || 0);
    });

    const labels = ['Protein', 'Carbs', 'Fat'];
    const values = [totalProtein, totalCarbs, totalFat];
    // Colors: Protein=Blue, Carbs=Purple, Fat=Green
    const colors = ['#007aff', '#5856d6', '#34c759']; 

    if (this.charts['doughnut']) this.charts['doughnut'].destroy();

    this.charts['doughnut'] = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: colors,
          hoverOffset: 4
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'right' },
          title: { display: true, text: 'Macro Distribution (g)' },
          tooltip: {
            callbacks: {
              label: (context) => {
                const label = context.label || '';
                const value = Number(context.raw || 0);
                const total = (context.chart.data.datasets[0].data as number[]).reduce((a, b) => a + Number(b), 0);
                const percentage = total > 0 ? Math.round((value / total) * 100) : 0;
                return `${label}: ${Math.round(value)}g (${percentage}%)`;
              }
            }
          }
        }
      }
    });
  }

  private renderBarChart(data: Entry[]): void {
    const ctx = this.barChartRef.nativeElement.getContext('2d');
    if (!ctx) return;

    // Last 7 days comparison
    const last7Days: string[] = [];
    const today = new Date();
    for(let i=6; i>=0; i--) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        last7Days.push(this.getLocalISODate(d));
    }

    const dailyCalories: { [date: string]: number } = {};
    data.forEach(e => {
        if (last7Days.includes(e.date)) {
            dailyCalories[e.date] = (dailyCalories[e.date] || 0) + (e.calories || 0);
        }
    });

    const values = last7Days.map(d => dailyCalories[d] || 0);
    
    // Format labels to be shorter (e.g. "Mon", "Tue")
    const labels = last7Days.map(d => {
        const date = new Date(d);
        return date.toLocaleDateString('en-US', { weekday: 'short' });
    });

    if (this.charts['bar']) this.charts['bar'].destroy();

    this.charts['bar'] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Calories',
          data: values,
          backgroundColor: values.map(v => v > 2000 ? '#ff3b30' : '#34c759'),
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false }
        },
        scales: {
          y: { beginAtZero: true }
        }
      }
    });
  }
}
